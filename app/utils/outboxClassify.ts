// app/utils/outboxClassify.ts
// Classification: a queue-time snapshot versus live state (spec §1). Pure — the
// sweep does the reads and hands the values in.

import type { NotifyKind } from "./notifyPrefs";
import type { OutboxSongRow } from "./outboxNotice";

export type LineKind =
  | "assigned" | "removed" | "roleChanged"
  | "setlistReady" | "setlistChanged"
  | "leadNotes";

export const LINE_PREF: Record<LineKind, NotifyKind> = {
  assigned: "assigned",
  removed: "removed",
  roleChanged: "roleChanged",
  setlistReady: "setlist",
  setlistChanged: "setlist",
  leadNotes: "proposals",
};

export interface Line {
  kind: LineKind;
  serviceDate: string;
  roleType: string | null;
  before: string[];
  after: string[];
  songs?: OutboxSongRow[];
  beforeSongs?: OutboxSongRow[];
  notes?: string;
}

/** Calendar-day comparison; both sides are already America/Mexico_City dates. */
const isPast = (serviceDate: string, today: string) => serviceDate < today;

const sameSet = (a: string[], b: string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export function classifyRole(i: {
  before: string[]; after: string[];
  serviceDate: string; roleType: string | null; today: string;
  roleExists: boolean; published: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  // An unpublish is silent today and stays silent. Gated on roleExists because
  // `published` only means something while the role document is still there —
  // for a vanished role, whatever the sweep passes for `published` is not a
  // real reading. The deleted-role branch below is deliberately independent
  // of this guard, so it stays correct no matter what that value is.
  if (i.roleExists && !i.published) return null;

  // A vanished role tells only the people who had already been introduced to it.
  // Without this gate, creating a published service and deleting it minutes
  // later mails every assignee "Ya no participas" about a service they were
  // never told existed — the create no longer sends immediately.
  if (!i.roleExists) {
    if (!i.before.length) return null;
    return { kind: "removed", serviceDate: i.serviceDate, roleType: i.roleType, before: i.before, after: [] };
  }

  if (sameSet(i.before, i.after)) return null;
  const kind: LineKind = !i.before.length ? "assigned" : !i.after.length ? "removed" : "roleChanged";
  return { kind, serviceDate: i.serviceDate, roleType: i.roleType, before: i.before, after: i.after };
}

const sameSongs = (a: OutboxSongRow[], b: OutboxSongRow[]) =>
  a.length === b.length &&
  a.every((r, n) => r.ref === b[n].ref && r.key === b[n].key && r.group === b[n].group);

export function classifySetlist(i: {
  before: OutboxSongRow[]; after: OutboxSongRow[];
  serviceDate: string; roleType: string | null; today: string;
  roleExists: boolean; published: boolean; dateMatches: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  if (!i.roleExists) return null;
  if (!i.published) return null;
  // A date move invalidates the snapshot: `before` was captured against another
  // week's setlist, so there is nothing truthful to say.
  if (!i.dateMatches) return null;
  if (!i.after.length) return null;
  if (sameSongs(i.before, i.after)) return null;

  return {
    kind: i.before.length ? "setlistChanged" : "setlistReady",
    serviceDate: i.serviceDate,
    roleType: i.roleType,
    before: [], after: [],
    songs: i.after,
    beforeSongs: i.before,
  };
}

export function classifyLeadNotes(i: {
  before: string; after: string;
  serviceDate: string; today: string; reviewable: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  if (!i.reviewable) return null;
  if (i.before.trim() === i.after.trim()) return null;
  return { kind: "leadNotes", serviceDate: i.serviceDate, roleType: null, before: [], after: [], notes: i.after };
}

/** The shape `LEAD_NOTE_MESSAGES` projects. Deliberately minimal: this
 *  classifier reads bodies and nothing else. */
export interface LeadNoteMessage {
  kind?: unknown;
  body?: unknown;
}

/**
 * The thread-sourced replacement for `classifyLeadNotes` (Child B §Outbox).
 *
 * Where `classifyLeadNotes` diffed one string against another, this diffs a
 * COUNT against an array: `beforeCount` is the number of `lead_note` messages
 * the proposal had when the notice was queued, and everything after that index
 * is what the admins have not been told about. The body is every appended
 * message joined, not just the newest, because the debounce deliberately
 * collapses a burst into one email and dropping the middle of a conversation is
 * worse than a longer one.
 *
 * `leadMessages` arrives ALREADY FILTERED by `LEAD_NOTE_MESSAGES` and must not
 * be re-filtered here — hence the parameter name. Re-filtering was the failure
 * mode that made the projection carry `kind`: if a caller narrows the query to
 * `{body}` and this function still filters, every element lacks `kind`, nothing
 * matches, and the debounced email dies silently with every test green.
 *
 * A count-and-slice is sound because `messages[]` is append-only and the
 * migration runs once, before any notice can be queued against a migrated
 * document, so no prepend shifts indices under a notice already in flight.
 *
 * "Append-only" is a property of the WRITE PATHS, not something the schema
 * enforces: no route deletes or reorders a message, but a write token or Vision
 * still can. Deleting an old lead note shifts every in-flight `beforeCount` and
 * re-sends the tail. An operational constraint, not a proven invariant.
 */
export function classifyProposalMessages(i: {
  beforeCount: number;
  leadMessages: readonly LeadNoteMessage[] | null | undefined;
  serviceDate: string;
  today: string;
  reviewable: boolean;
}): Line | null {
  if (isPast(i.serviceDate, i.today)) return null;
  if (!i.reviewable) return null;

  // GROQ hands back `null` (not `[]`) for a document with no `messages`.
  const messages = Array.isArray(i.leadMessages) ? i.leadMessages : [];

  // A non-integer or negative count is an upstream bug. `slice` reads a
  // negative as an offset from the END, so the batch would silently become the
  // last |n| messages — a re-send whose SIZE depends on the corrupt value, and
  // which looks like a plausible email. Clamping to 0 re-sends everything
  // instead — never fewer than the negative slice would, and more whenever
  // `|n| < length` — so the mistake is obvious rather than plausible. Both
  // re-send already-delivered content; only one of them is loud about it.
  //
  // `NaN` is handled here rather than upstream because it survives a
  // `typeof === "number"` check. Whether Child B's caller lets one through
  // depends on a guard that does not exist yet — this is total either way.
  const beforeCount = Number.isInteger(i.beforeCount) ? Math.max(0, i.beforeCount) : 0;

  const appended = messages.slice(beforeCount);
  // Defensive: `buildProposalMessage` cannot store a non-string or empty body,
  // so this only fires on hand-edited data. Dropping such an entry is right —
  // there is no text to send — and if that empties the batch we say nothing
  // rather than mail a blank section.
  const bodies = appended
    .map((m) => m.body)
    .filter((b): b is string => typeof b === "string" && b.trim() !== "");
  if (bodies.length === 0) return null;

  return {
    kind: "leadNotes",
    serviceDate: i.serviceDate,
    roleType: null,
    before: [],
    after: [],
    notes: bodies.join("\n\n"),
  };
}
