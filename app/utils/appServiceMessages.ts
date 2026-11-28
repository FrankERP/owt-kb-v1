// The native app's «Mensajes del servicio» (A-W2 spec,
// `docs/superpowers/specs/2026-11-28-native-service-messages-design.md`): the wire shapes of the
// admin's read door and of the answers of its four write doors. Pure: no client, no I/O.
//
// What never crosses: a member id. People are names plus `mine`, exactly as on the proposal
// editor's door (`messagesOf`). Document ids do cross where a write must assert them (the team
// note's observed setlist target), as on the web.
//
// The service thread and the proposal's thread travel APART (spec D2): a write answer replaces the
// service list only, and the proposal list changes only on a read, as the web dialog does.

import { messagesOf, type AppThreadMessage } from "./appProposalEditor";
import { appServiceTitle } from "./appServices";
import { isThreadOpen } from "./proposalThread";
import type { ThreadMessageRow } from "./proposalMessageRead";
import { teamNotesTarget, type ConversationRead, type PastorMessageRow } from "./serviceThread";
import { isMessageKey, offeredProposalPastorMessage, pastorMessageStamp } from "./serviceMessageEdit";

/** A conversation row, plus whether the caller may edit or delete it from the app. */
export type AppServiceThreadMessage = AppThreadMessage & { editable: boolean };

export type AppPastorMessage = {
  body: string;
  authorName: string | null;
  at: string | null;
  editedAt: string | null;
  /** `pastorMessageStamp`: sent back verbatim as the PUT's `observed`. */
  stamp: string;
};

export type AppTeamNotes = null | { unavailable: "ambiguous" } | { text: string; observed: { id: string; rev: string } };

export type AppServiceMessages = {
  service: {
    id: string;
    kind: "sunday" | "saturday" | "special";
    date: string;
    title: string;
    published: boolean;
    /** Names only. */
    leads: string[];
  };
  /** `isThreadOpen` at read time: the conversation takes messages. */
  open: boolean;
  pastorMessage: AppPastorMessage | null;
  teamNotes: AppTeamNotes;
  proposal: null | {
    status: "draft" | "pending" | "approved" | "changes_requested";
    offeredPastorMessage: string | null;
  };
  serviceMessages: AppServiceThreadMessage[];
  proposalMessages: AppServiceThreadMessage[];
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const KINDS: Record<string, "sunday" | "saturday" | "special"> = {
  sunday_role: "sunday",
  saturday_role: "saturday",
  special_role: "special",
};
const STATUSES = new Set(["draft", "pending", "approved", "changes_requested"]);

/**
 * One thread's rows as the app shows them. `editable` is decided on the STORED row, before
 * `messagesOf` maps it (spec A4): a fallback key such as `s0` passes `isMessageKey`, so the output
 * key is never what is tested. Only the service thread is ever editable: an admin edits only their
 * own service-thread messages, never a lead's (those live on the proposal).
 */
function rowsOf(
  rows: ThreadMessageRow[] | null | undefined,
  me: string,
  source: "s" | "p",
  open: boolean,
): AppServiceThreadMessage[] {
  const list = Array.isArray(rows) ? rows : [];
  // `messagesOf` skips rows with no body; keep the stored rows it kept, in the same order.
  const kept = list.filter((m) => !!m && !!text(m.body));
  return messagesOf(list, me, source).map((message, i) => {
    const stored = kept[i];
    const editable =
      source === "s" && open && message.mine && typeof stored?._key === "string" && isMessageKey(stored._key);
    return { ...message, editable };
  });
}

/**
 * The stored pastor's message as the app shows it. Presence is the writer's own test (a non-empty
 * stored body, `setPastorMessage`): an empty body is no message (A6), while a whitespace-only one,
 * which only Studio can store, IS one, so its stamp is sent back and «Quitar» can clear it.
 */
export function appPastorMessage(row: PastorMessageRow | null | undefined, authorNameFallback?: string): AppPastorMessage | null {
  const raw = typeof row?.body === "string" ? row.body : "";
  if (!row || !raw) return null;
  const body = text(raw) ?? raw;
  const stamp = pastorMessageStamp(row);
  if (!stamp) return null;
  return {
    body,
    authorName: text(row.author_name) ?? text(authorNameFallback),
    at: text(row.at),
    editedAt: text(row.edited_at),
    stamp,
  };
}

/** The read door's answer. `me` is the caller's member id; `today` the CDMX day (tests pin it). */
export function buildAppServiceMessages(
  read: ConversationRead,
  me: string,
  today?: string,
): AppServiceMessages | null {
  const service = read.service;
  if (!service) return null;
  const kind = KINDS[service._type];
  const date = text(service.service_date)?.slice(0, 10) ?? null;
  if (!kind || !date) return null;
  const open = isThreadOpen({ serviceDate: date, today });

  const leadsRaw = Array.isArray(service.leads) ? (service.leads as Array<{ name?: unknown } | null>) : [];
  const leads = leadsRaw.map((l) => text(l?.name)).filter((n): n is string => !!n);

  const proposalRaw = (read.proposal ?? null) as {
    status?: unknown;
    pastor_message?: unknown;
    messages?: ThreadMessageRow[] | null;
  } | null;
  const pastorRow = (read.pastor_message ?? null) as PastorMessageRow | null;
  const status = typeof proposalRaw?.status === "string" && STATUSES.has(proposalRaw.status) ? proposalRaw.status : null;

  const { _rev, team_notes, hasSongs } = service;
  return {
    service: {
      id: service._id,
      kind,
      date,
      title: appServiceTitle(kind, service.service_name),
      published: service.published !== false,
      leads,
    },
    open,
    pastorMessage: appPastorMessage(pastorRow),
    teamNotes: teamNotesTarget(service, read.weekendSetlists, { _rev, team_notes, hasSongs }),
    proposal: status
      ? {
          status: status as "draft" | "pending" | "approved" | "changes_requested",
          offeredPastorMessage: offeredProposalPastorMessage({
            proposal: {
              status,
              pastor_message: typeof proposalRaw?.pastor_message === "string" ? proposalRaw.pastor_message : null,
            },
            pastor_message: pastorRow,
          }),
        }
      : null,
    serviceMessages: rowsOf(read.messages as ThreadMessageRow[] | null | undefined, me, "s", open),
    proposalMessages: rowsOf(proposalRaw?.messages, me, "p", open),
  };
}

/**
 * A message write's answer (POST, PATCH, DELETE): the SERVICE thread's read-back, or `null` when
 * the writer's guarded read-back failed («keep what you show»). The writer's `message` row (its
 * author is a member id) and `ok` are dropped. `open` is true: the writer has just enforced
 * `isThreadOpen` for this write (spec A4).
 */
export function appServiceMessagesAnswer(result: { status: number; body: unknown }, me: string): { status: number; body: unknown } {
  const body = (result.body ?? {}) as { messages?: unknown };
  return {
    status: result.status,
    body: {
      serviceMessages: Array.isArray(body.messages) ? rowsOf(body.messages as ThreadMessageRow[], me, "s", true) : null,
    },
  };
}

/**
 * The pastor's-message PUT's answer. When the writer's read-back failed, its fallback row carries
 * `author: <member id>` and no name: only `body`, `at` and `edited_at` are taken, and the caller's
 * own name stands in.
 */
export function appPastorAnswer(result: { status: number; body: unknown }, myName: string): { status: number; body: unknown } {
  const body = (result.body ?? {}) as { pastor_message?: unknown };
  const row = (body.pastor_message ?? null) as PastorMessageRow | null;
  const safe: PastorMessageRow | null = row
    ? { body: row.body, at: row.at, edited_at: row.edited_at ?? null, author_name: row.author_name ?? null }
    : null;
  return { status: result.status, body: { pastorMessage: appPastorMessage(safe, myName) } };
}

/** The team-notes PUT's answer, verbatim: the note and the observed setlist target (document ids only). */
export function appTeamNotesAnswer(result: { status: number; body: unknown }): { status: number; body: unknown } {
  const body = (result.body ?? {}) as { teamNotes?: unknown; observed?: { id?: unknown; rev?: unknown } };
  const id = typeof body.observed?.id === "string" ? body.observed.id : "";
  const rev = typeof body.observed?.rev === "string" ? body.observed.rev : "";
  return {
    status: result.status,
    body: {
      teamNotes: typeof body.teamNotes === "string" && body.teamNotes ? body.teamNotes : null,
      observed: { id, rev },
    },
  };
}
