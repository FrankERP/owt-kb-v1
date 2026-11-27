// The native app's admin proposal review (A-W1 spec D3,
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`): the list the app's
// `GET /api/app/v1/admin/proposals` answers, and the answers of its two write doors.
//
// NEUTRAL module (no client, no I/O), tested without a network. Its rules:
//
//  - no member id on the wire: the lead, the co-leads and every thread author go out as names, and
//    a message's `mine` is computed here (`messagesOf`, shared with the lead's editor read);
//  - a song row with no song reference is left out of what is SHOWN only: the decision writer
//    refuses such a proposal (`proposal_songs_malformed`) and the app gets that 409, never a
//    silent publish;
//  - a refusal crosses as `{ error, conflict, details?: { issues } }` and nothing else of the
//    writer's `details` (`appRefusal`), so both admin doors answer one shape.

import type { ThreadMessageRow } from "./proposalMessageRead";
import type { AdminProposalRow } from "./adminProposalsRead";
import { messagesOf, type AppThreadMessage } from "./appProposalEditor";
import { SPECIAL_SERVICE_FALLBACK } from "./emailServiceLabel";
import { isThreadOpen } from "./proposalThread";
import { sortProposals } from "@/app/components/admin/proposalListView";

export type AppAdminProposalStatus = "draft" | "pending" | "approved" | "changes_requested";

export type AppAdminProposal = {
  id: string;
  rev: string;
  status: AppAdminProposalStatus;
  service: { kind: "sunday" | "saturday" | "special"; date: string; title: string };
  leadName: string | null;
  /** Contributors other than the lead, names only (the web panel's filter). */
  coLeads: string[];
  songs: {
    songId: string;
    title: string;
    author: string | null;
    key: string | null;
    /** The key the lead proposes: the web's `play_key || key`. */
    playKey: string;
    medleyTag: string | null;
  }[];
  pastorMessage: string | null;
  teamNotes: string | null;
  messages: AppThreadMessage[];
  earlierMessages: AppThreadMessage[];
  /** The writers' own rule (`isThreadOpen`): the service is today or later in CDMX. */
  threadOpen: boolean;
};

const STATUSES = new Set<AppAdminProposalStatus>(["draft", "pending", "approved", "changes_requested"]);
const KINDS = new Set(["sunday", "saturday", "special"]);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function titleOf(kind: "sunday" | "saturday" | "special", serviceName: unknown): string {
  if (kind === "sunday") return "Domingo";
  if (kind === "saturday") return "Sábado";
  return text(serviceName)?.replace(/\s+/g, " ") ?? SPECIAL_SERVICE_FALLBACK;
}

function proposalOf(row: AdminProposalRow, me: string, today: string): AppAdminProposal | null {
  const id = text(row._id);
  const rev = text(row._rev);
  const status = row.status as AppAdminProposalStatus;
  const kind = row.service_type as "sunday" | "saturday" | "special";
  const date = typeof row.service_date === "string" ? row.service_date.slice(0, 10) : "";
  if (!id || !rev || !STATUSES.has(status) || !KINDS.has(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const leadId = text(row.lead_id);
  const coLeads = (Array.isArray(row.contributors) ? row.contributors : []).flatMap((c: unknown) => {
    const entry = (c ?? {}) as { id?: unknown; name?: unknown };
    const name = text(entry.name);
    const cid = text(entry.id);
    return name && cid && cid !== leadId ? [name] : [];
  });

  const songs: AppAdminProposal["songs"] = [];
  for (const s of Array.isArray(row.songs) ? row.songs : []) {
    const song = (s ?? {}) as Record<string, unknown>;
    const songId = text(song.song_id);
    if (!songId) continue;
    const key = text(song.key);
    songs.push({
      songId,
      title: text(song.title) ?? "Canción sin título",
      author: text(song.author),
      key,
      playKey: text(song.play_key) ?? key ?? "",
      medleyTag: text(song.medley_tag),
    });
  }

  return {
    id,
    rev,
    status,
    service: { kind, date, title: titleOf(kind, row.service_name) },
    leadName: text(row.lead_name),
    coLeads,
    songs,
    pastorMessage: text(row.pastor_message),
    teamNotes: text(row.team_notes),
    messages: messagesOf(row.messages as ThreadMessageRow[] | null, me, "p"),
    earlierMessages: messagesOf(row.earlier_messages as ThreadMessageRow[] | null, me, "s"),
    threadOpen: isThreadOpen({ serviceDate: date, today }),
  };
}

/**
 * The list the app shows, ordered as `/admin` orders it (`sortProposals`: status buckets, approved
 * newest first, the rest soonest first). `me` is the caller's member id; `today` the CDMX date.
 */
export function buildAppAdminProposals(
  rows: readonly AdminProposalRow[],
  me: string,
  today: string,
): { proposals: AppAdminProposal[] } {
  const built = rows.flatMap((row) => {
    const p = proposalOf(row, me, today);
    return p ? [{ _id: p.id, status: p.status, service_date: p.service.date, p }] : [];
  });
  return { proposals: sortProposals(built).map((entry) => entry.p) };
}

/** The ONE wire shape of a refusal from either admin door. */
export function appRefusal(result: { status: number; body: unknown }): { status: number; body: unknown } {
  const body = (result.body ?? {}) as { error?: unknown; conflict?: unknown; details?: unknown };
  const issuesRaw = (body.details as { issues?: unknown } | undefined)?.issues;
  const issues =
    Array.isArray(issuesRaw) && issuesRaw.every((i) => typeof i === "string") ? (issuesRaw as string[]) : null;
  return {
    status: result.status,
    body: {
      error: typeof body.error === "string" ? body.error : "error",
      conflict: body.conflict === true,
      ...(issues ? { details: { issues } } : {}),
    },
  };
}

/**
 * The decision door's answer. A success keeps what the app shows: the status after the call,
 * whether it was a no-write replay, and what the approval did with the pastor's message
 * (ADR-0087). The writer's `setlistId`, `targetKey` and `ok` stay on the server.
 */
export function appReviewAnswer(result: { status: number; body: unknown }): { status: number; body: unknown } {
  if (result.status < 200 || result.status >= 300) return appRefusal(result);
  const body = (result.body ?? {}) as { status?: unknown; idempotent?: unknown; pastorMessage?: unknown };
  return {
    status: result.status,
    body: {
      status: typeof body.status === "string" ? body.status : null,
      idempotent: body.idempotent === true,
      pastorMessage: typeof body.pastorMessage === "string" ? body.pastorMessage : null,
    },
  };
}
