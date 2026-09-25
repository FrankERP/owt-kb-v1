// What `list_proposals` reports (P1 step 7): each proposal's LIVE message
// thread and whether it is still open — never the frozen `lead_notes` /
// `admin_notes` / `team_notes` archive fields (ledger A7). No I/O here: every
// function reads a `ServiceSnapshot` (`loadServiceSnapshot()`) the tool already
// fetched, plus the two content lookups `get_service` already uses (member
// names, song titles).
//
// LINKING — read from `serviceReadModel.ts:82-92` (`proposalTargetKey`) and
// followed exactly rather than invented, over the snapshot's own rows instead
// of re-deriving a key format to compare against `roleTargetKey` (the two
// index different domains under different namespaces on purpose, so this
// module never compares one against the other). A weekend proposal
// (`service_type` "sunday" | "saturday") resolves to the ONE canonical
// service of that kind whose own calendar day (`storedRoleDate` — a
// Saturday's is the Saturday's own date) equals the proposal's
// `service_date`; more than one match (a duplicate weekend target) or none is
// UNRESOLVED, never a guess (A15's discipline). A special proposal resolves by
// `service_ref`: the canonical special service that id names (`serviceKindOf`,
// never a role-type literal — spec I2), or unresolved when it names none.
// Either way an unresolvable link reports `serviceId: null`, never a dropped
// proposal.
//
// UNREAD STATE IS NEVER REPORTED (ADR-0024): there is no read-mark on either
// document, so nothing here derives one.

import { isThreadOpen, orderedMessages } from "@/app/utils/proposalThread";
import { isCanonicalDocumentId, storedRoleDate } from "@/app/utils/roleWriteRequest";
import { PROPOSAL_STATUSES, SERVICE_KINDS } from "@/app/utils/serviceReadModel";
import type { ServiceSourceKey } from "@/app/components/admin/serviceReadiness";
import { serviceKindOf, type ServiceKind } from "./servicePresenter";
import type { MemberNameLookup, ServiceSnapshot, SnapshotRow } from "./serviceSnapshot";
import type { SongTitleLookup } from "./songTitles";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ── Readability (a failed roles OR proposals source is never "no proposals") ─

/** True when the roles or the proposals domain failed: a "no proposals" answer would be a lie either way (roles resolves the link). */
export function proposalsUnreadable(snapshot: ServiceSnapshot): boolean {
  return snapshot.readiness.sources.roles !== "ready" || snapshot.readiness.sources.proposals !== "ready";
}

export const LIST_PROPOSALS_UNREADABLE_MESSAGE =
  "No se pudieron leer los servicios o las propuestas, así que no se puede decir qué propuestas hay. Intenta de nuevo en un momento.";

function failedSourcesOf(snapshot: ServiceSnapshot): { failedSources?: ServiceSourceKey[] } {
  const failed = snapshot.readiness.failedSources;
  return failed.length ? { failedSources: [...failed] } : {};
}

// ── Linking ──────────────────────────────────────────────────────────────────

interface CatalogueEntry {
  serviceId: string;
  kind: ServiceKind;
  date: string | null;
}

/** Every canonical, validly-identified service, exactly as `get_service`'s own catalogue admits one. */
function catalogueEntries(snapshot: ServiceSnapshot): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (const row of snapshot.roles) {
    const kind = serviceKindOf(row._type);
    const id = stringOrNull(row._id);
    if (!kind || !id || !isCanonicalDocumentId(id)) continue;
    out.push({ serviceId: id, kind, date: storedRoleDate(row) });
  }
  return out;
}

/**
 * The ONE canonical service this proposal names, by the writer's own linking
 * rule — never a guess. `null` when `service_type` is unrecognized, the
 * relevant field (`service_date` for a weekend, `service_ref` for a special)
 * is missing or malformed, a weekend match is ambiguous (more than one
 * canonical service shares that kind and date), or a special's `service_ref`
 * names no canonical special.
 */
export function resolveProposalServiceId(snapshot: ServiceSnapshot, row: SnapshotRow): string | null {
  const kind = row.service_type;
  if (kind === "special") {
    const ref = stringOrNull(row.service_ref);
    if (!ref) return null;
    const role = snapshot.readiness.rolesById.get(ref);
    return isObj(role) && serviceKindOf(role._type) === "special" ? ref : null;
  }
  if (kind === "sunday" || kind === "saturday") {
    const date = stringOrNull(row.service_date);
    if (!date) return null;
    const matches = catalogueEntries(snapshot).filter((e) => e.kind === kind && e.date === date);
    return matches.length === 1 ? matches[0]!.serviceId : null;
  }
  return null;
}

// ── Selecting proposals ──────────────────────────────────────────────────────

/** Every canonical proposal linking to `role`, by the same rule `resolveProposalServiceId` reports. */
export function proposalsForService(snapshot: ServiceSnapshot, role: SnapshotRow): SnapshotRow[] {
  const targetId = stringOrNull(role._id);
  if (!targetId) return [];
  return snapshot.proposals.filter((row) => resolveProposalServiceId(snapshot, row) === targetId);
}

/** Every canonical proposal whose OWN `service_date` falls in `month` ("YYYY-MM"). */
export function proposalsForMonth(snapshot: ServiceSnapshot, month: string): SnapshotRow[] {
  const prefix = `${month}-`;
  return snapshot.proposals.filter((row) => {
    const date = stringOrNull(row.service_date);
    return date !== null && date.startsWith(prefix);
  });
}

function compareProposals(a: SnapshotRow, b: SnapshotRow): number {
  const da = stringOrNull(a.service_date);
  const db = stringOrNull(b.service_date);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  const ia = stringOrNull(a._id) ?? "";
  const ib = stringOrNull(b._id) ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

// ── Content ids (for the two supplementary reads) ───────────────────────────

/** Every member and song id the given proposals name: lead, contributors, the WHOLE message thread's authors, and setlist songs. */
export function proposalContentIds(rows: readonly SnapshotRow[]): { memberIds: string[]; songIds: string[] } {
  const memberIds = new Set<string>();
  const songIds = new Set<string>();
  for (const row of rows) {
    const lead = stringOrNull(row.lead);
    if (lead) memberIds.add(lead);
    if (Array.isArray(row.contributors)) {
      for (const c of row.contributors) {
        const person = isObj(c) ? stringOrNull(c.person) : null;
        if (person) memberIds.add(person);
      }
    }
    if (Array.isArray(row.messages)) {
      for (const m of row.messages) {
        const author = isObj(m) ? stringOrNull(m.author) : null;
        if (author) memberIds.add(author);
      }
    }
    if (Array.isArray(row.songs)) {
      for (const item of row.songs) {
        const songId = isObj(item) && isObj(item.song) && nonEmptyString(item.song._ref) ? item.song._ref : null;
        if (songId) songIds.add(songId);
      }
    }
  }
  return { memberIds: [...memberIds], songIds: [...songIds] };
}

// ── Presentation ─────────────────────────────────────────────────────────────

export type ProposalMemberRef = { memberId: string | null; name: string | null };
export type ProposalSongRow = {
  rowKey: string | null;
  song: { id: string; title: string | null } | null;
  key: string | null;
};
export type ProposalMessageView = {
  at: string | null;
  authorName: string | null;
  authorRole: string | null;
  kind: string | null;
  body: string | null;
};

export type ProposalEntry = {
  proposalId: string;
  /** The one canonical service this proposal names, or null when the link is unresolvable (never a guess). */
  serviceId: string | null;
  serviceDate: string | null;
  kind: ServiceKind | null;
  status: (typeof PROPOSAL_STATUSES)[number] | null;
  lead: ProposalMemberRef;
  contributors: ProposalMemberRef[];
  songs: ProposalSongRow[];
  /** `isThreadOpen`, unchanged: open through the service date, independent of `status`. */
  threadOpen: boolean;
  /** The full thread length, even when `messages` below was capped (D6). */
  messagesTotal: number;
  /** True only when `messages` was capped to the last 10 (D6, month mode). */
  truncated: boolean;
  /** `messages[]` ONLY (ledger A7): never `lead_notes` / `admin_notes` / `team_notes`. */
  messages: ProposalMessageView[];
};

function memberRef(id: unknown, members: MemberNameLookup): ProposalMemberRef {
  const memberId = stringOrNull(id);
  if (!memberId) return { memberId: null, name: null };
  const member = members.byId.get(memberId);
  return { memberId, name: member ? stringOrNull(member.member_name) : null };
}

/** Stored-message shape `orderedMessages` needs (`at?: string | null`), plus the fields the payload reports. */
interface RawProposalMessage {
  readonly author?: unknown;
  readonly author_role?: unknown;
  readonly kind?: unknown;
  readonly body?: unknown;
  readonly at?: string | null;
}

function presentMessage(message: RawProposalMessage, members: MemberNameLookup): ProposalMessageView {
  const authorId = stringOrNull(message.author);
  return {
    at: stringOrNull(message.at),
    // An unresolvable author (unknown id, or the lookup read failed) is null either way — never leaked which case it was.
    authorName: authorId ? stringOrNull(members.byId.get(authorId)?.member_name) : null,
    authorRole: stringOrNull(message.author_role),
    kind: stringOrNull(message.kind),
    body: stringOrNull(message.body),
  };
}

const MONTH_MESSAGE_CAP = 10;

/**
 * One proposal, as `list_proposals` reports it. `capMessages` is D6: false for
 * `{ serviceId }` (the whole thread), true for `{ month }` (the last 10,
 * chronological). `messagesTotal` is always the full count regardless.
 * `lead_notes` / `admin_notes` / `team_notes` are never read here (A7).
 */
export function presentProposal(
  snapshot: ServiceSnapshot,
  row: SnapshotRow,
  lookups: { members: MemberNameLookup; songs: SongTitleLookup },
  today: string,
  capMessages: boolean,
): ProposalEntry {
  const kind = (SERVICE_KINDS as readonly unknown[]).includes(row.service_type)
    ? (row.service_type as ServiceKind)
    : null;
  const status = (PROPOSAL_STATUSES as readonly unknown[]).includes(row.status)
    ? (row.status as (typeof PROPOSAL_STATUSES)[number])
    : null;

  const rawSongs = Array.isArray(row.songs) ? row.songs : [];
  const songs: ProposalSongRow[] = rawSongs.map((item): ProposalSongRow => {
    const obj = isObj(item) ? item : {};
    const songId = isObj(obj.song) && nonEmptyString(obj.song._ref) ? obj.song._ref : null;
    const title = songId ? (lookups.songs.byId.get(songId)?.title ?? null) : null;
    return {
      rowKey: stringOrNull(obj._key),
      song: songId ? { id: songId, title } : null,
      key: stringOrNull(obj.play_key),
    };
  });

  const rawMessages = Array.isArray(row.messages) ? row.messages : [];
  const ordered = orderedMessages(rawMessages as RawProposalMessage[]);
  const messagesTotal = ordered.length;
  const capped = capMessages ? ordered.slice(-MONTH_MESSAGE_CAP) : ordered;
  const truncated = capMessages && messagesTotal > MONTH_MESSAGE_CAP;

  const rawContributors = Array.isArray(row.contributors) ? row.contributors : [];

  return {
    proposalId: stringOrNull(row._id) ?? "",
    serviceId: resolveProposalServiceId(snapshot, row),
    serviceDate: stringOrNull(row.service_date),
    kind,
    status,
    lead: memberRef(row.lead, lookups.members),
    contributors: rawContributors.map((c) => memberRef(isObj(c) ? c.person : null, lookups.members)),
    songs,
    threadOpen: isThreadOpen({ serviceDate: row.service_date, today }),
    messagesTotal,
    truncated,
    messages: capped.map((m) => presentMessage(m, lookups.members)),
  };
}

// ── list_proposals ───────────────────────────────────────────────────────────

export type ListProposalsPayload =
  | { serviceId: string; proposals: ProposalEntry[]; failedSources?: ServiceSourceKey[] }
  | { month: string; proposals: ProposalEntry[]; failedSources?: ServiceSourceKey[] };

export interface ProposalLookups {
  members: MemberNameLookup;
  songs: SongTitleLookup;
}

/** D6: the whole thread — every proposal linking to `role`, full `messages`. */
export function presentProposalsForService(
  snapshot: ServiceSnapshot,
  role: SnapshotRow,
  lookups: ProposalLookups,
  today: string,
): ListProposalsPayload {
  const rows = proposalsForService(snapshot, role).slice().sort(compareProposals);
  const proposals = rows.map((row) => presentProposal(snapshot, row, lookups, today, false));
  return { serviceId: stringOrNull(role._id) ?? "", proposals, ...failedSourcesOf(snapshot) };
}

/** D6: every proposal dated in `month`, each capped to its last 10 messages. */
export function presentProposalsForMonth(
  snapshot: ServiceSnapshot,
  month: string,
  lookups: ProposalLookups,
  today: string,
): ListProposalsPayload {
  const rows = proposalsForMonth(snapshot, month).slice().sort(compareProposals);
  const proposals = rows.map((row) => presentProposal(snapshot, row, lookups, today, true));
  return { month, proposals, ...failedSourcesOf(snapshot) };
}
