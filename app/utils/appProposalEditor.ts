// The native app's setlist-proposal editor read (ADR-0091 W1, spec D3): what
// `GET /api/app/v1/proposals/[roleId]` answers, shaped from `readProposalEditor`'s documents.
//
// NEUTRAL module (no client, no I/O), tested without a network. Its rules:
//
//  - `observed` is built from the SAME proposal document the fields come from, so what the app
//    sends back on its save is what it was shown (the writer compares id + revision only);
//  - the song rows use the save body's spelling (`songId`, `play_key`, `medley_tag`), because the
//    writer's `parseSongRows` ignores unknown keys: a client echoing another spelling would save
//    with no keys and no medleys and still get a 200 (spec D3, D7b);
//  - no member id on the wire, as in `appServices.ts`: contributors and thread messages carry a
//    name and a server-computed `mine`, never the author's id.

import type { ThreadMessageRow } from "./proposalMessageRead";
import type { ProposalEditorRead } from "./proposalEditorRead";
import { SPECIAL_SERVICE_FALLBACK } from "./emailServiceLabel";
import { isCanonicalDocumentId } from "./roleWriteRequest";

export type AppObserved = { state: "none" } | { state: "single"; id: string; rev: string };

export type AppProposalSong = {
  songId: string;
  title: string;
  author: string | null;
  /** The song's own key in the library. */
  key: string | null;
  /** The key the lead proposes (the web's `play_key || key`). */
  play_key: string;
  /** `null` when the row is not in a medley — never `""`, which the writer refuses. */
  medley_tag: string | null;
  previous_keys: string[];
};

export type AppThreadMessage = {
  key: string;
  authorName: string | null;
  authorRole: string | null;
  kind: string | null;
  body: string;
  at: string | null;
  editedAt: string | null;
  mine: boolean;
};

export type AppProposalEditor = {
  role: { id: string; kind: "sunday" | "saturday" | "special"; date: string; title: string };
  observed: AppObserved;
  proposal: null | {
    status: "draft" | "pending" | "approved" | "changes_requested";
    songs: AppProposalSong[];
    contributors: { name: string; mine: boolean }[];
    teamNotes: string;
    pastorMessage: string;
    adminNotes: string | null;
    messages: AppThreadMessage[];
  };
  serviceThread: { messages: AppThreadMessage[]; pastorMessage: string | null };
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const PROPOSAL_STATUSES = new Set(["draft", "pending", "approved", "changes_requested"]);

function messagesOf(rows: ThreadMessageRow[] | null | undefined, me: string): AppThreadMessage[] {
  if (!Array.isArray(rows)) return [];
  const out: AppThreadMessage[] = [];
  rows.forEach((m, i) => {
    const body = m ? text(m.body) : null;
    if (!m || !body) return;
    out.push({
      key: text(m._key) ?? `m${i}`,
      authorName: text(m.author_name),
      authorRole: text(m.author_role),
      kind: text(m.kind),
      body,
      at: text(m.at),
      editedAt: text(m.edited_at),
      mine: !!m.author && m.author === me,
    });
  });
  return out;
}

/**
 * The wire answer. `me` is the caller's member id; `previousKeys` maps a song id to the keys it was
 * played in before (`previousKeysFor`). Stored song rows with no song reference are not editable
 * and are left out (the web would refuse to save them too).
 */
export function buildAppProposalEditor(
  read: ProposalEditorRead,
  me: string,
  previousKeys: ReadonlyMap<string, string[]>,
): AppProposalEditor {
  const { roleDoc, serviceType, serviceDate, proposal, thread } = read;
  const title =
    serviceType === "sunday" ? "Domingo" :
    serviceType === "saturday" ? "Sábado" :
    text(roleDoc.service_name)?.replace(/\s+/g, " ") ?? SPECIAL_SERVICE_FALLBACK;

  const role = { id: roleDoc._id, kind: serviceType, date: serviceDate, title };
  const serviceThread = { messages: messagesOf(thread.messages, me), pastorMessage: text(thread.pastorMessage) };

  if (!proposal || !text(proposal._id) || !text(proposal._rev)) {
    return { role, observed: { state: "none" }, proposal: null, serviceThread };
  }

  const songs: AppProposalSong[] = [];
  for (const s of Array.isArray(proposal.songs) ? proposal.songs : []) {
    const songId = s ? text(s.song_id) : null;
    if (!s || !songId) continue;
    const key = text(s.key);
    songs.push({
      songId,
      title: text(s.title) ?? "Canción sin título",
      author: text(s.author),
      key,
      play_key: text(s.play_key) ?? key ?? "",
      medley_tag: text(s.medley_tag),
      previous_keys: previousKeys.get(songId) ?? [],
    });
  }

  const contributors = (Array.isArray(proposal.contributors) ? proposal.contributors : []).flatMap((c) => {
    const name = c ? text(c.name) : null;
    return c && name ? [{ name, mine: !!c.id && c.id === me }] : [];
  });

  return {
    role,
    observed: { state: "single", id: proposal._id, rev: proposal._rev },
    proposal: {
      status: PROPOSAL_STATUSES.has(proposal.status) ? proposal.status : "draft",
      songs,
      contributors,
      // Sent back verbatim on every save, as the web editor does: `""` when stored empty.
      teamNotes: typeof proposal.team_notes === "string" ? proposal.team_notes : "",
      pastorMessage: typeof proposal.pastor_message === "string" ? proposal.pastor_message : "",
      adminNotes: text(proposal.admin_notes),
      messages: messagesOf(proposal.messages, me),
    },
    serviceThread,
  };
}

/** The song ids `previousKeysFor` is asked about: the proposal's rows, deduplicated. */
export function proposalSongIds(read: ProposalEditorRead): string[] {
  const ids = new Set<string>();
  for (const s of read.proposal?.songs ?? []) {
    const id = s ? text(s.song_id) : null;
    if (id) ids.add(id);
  }
  return [...ids];
}

/** The most song ids one «Tonos anteriores» request may ask about (spec D3b). */
export const PREVIOUS_KEYS_MAX_IDS = 50;

/** The ids of `?ids=`, deduplicated in order, or `null` when any is malformed, none is given, or there are too many. */
export function parsePreviousKeysIds(raw: string | null): string[] | null {
  const ids = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > PREVIOUS_KEYS_MAX_IDS) return null;
  return ids.every((id) => isCanonicalDocumentId(id)) ? ids : null;
}
