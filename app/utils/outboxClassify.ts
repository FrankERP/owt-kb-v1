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
  // An unpublish is silent today and stays silent.
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
