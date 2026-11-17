// What a write to a Jóvenes meeting owes people by email: who it newly assigns, and whether a
// request for music from the worship team appeared or went away (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` M5).
//
// PURE and NEUTRAL. The writer (`ministryEventCommit.ts`) builds `before` from the stored row it
// read BEFORE its commit — the exact state the write replaces, since every write asserts that
// row's revision — and `after` from the fields it stores, and calls `meetingNotices`. Nothing is
// re-read after the commit: a live read there would see the new state on both sides and announce
// nothing (the rule `docs/NOTIFICATIONS.md` records for the worship emails).
//
// The audience this computes is deliberately narrow (plan D4): only a whole-ministry meeting,
// only while it is published and not past, only the people the write adds — everyone on it when
// the write is what makes it visible (a publish) or moves its date. The sender is a free Gmail
// account; a group's classes («Nuevo libro» creates up to 60 in a row) announce nothing.

import { PLATICA_SEAT, isPartMusic, partSpec, type PartId, type PartMusic } from "./ministryParts";

export type SnapshotSeat = { role: string; member: string | null; name: string | null };
export type SnapshotLine = {
  key: string;
  part: PartId | null;
  label: string;
  members: string[];
  music: PartMusic | null;
  note: string | null;
};

/** The fields of a meeting a notice depends on, read the same way from a stored row and from a write. */
export type MeetingSnapshot = {
  ministryWide: boolean;
  published: boolean;
  date: string;
  seats: SnapshotSeat[];
  lines: SnapshotLine[];
};

/** `partners`: the other members who hold the same role («junto con Andy»). */
export type AssignedRole = { kind: "seat" | "part" | "line"; id: string; label: string; partners: string[] };
export type MusicPart = "oracion" | "platica";
export type MusicNotice = {
  part: MusicPart;
  /** `true`: they ask for someone from the worship team. `false`: they no longer do. */
  asks: boolean;
  note: string | null;
  /** The part's responsables: member ids, and typed names (a guest who shares). */
  members: string[];
  names: string[];
};

export type MeetingNotices = {
  /**
   * `moved`: present only for a person who already held a role on the meeting when it was
   * announced on another date — their email says it moved. Someone the same write adds was never
   * told the old date, so theirs is a plain «Te toca».
   */
  assigned: Array<{ memberId: string; roles: AssignedRole[]; moved?: true }>;
  /** The meeting was already announced on another date. */
  moved: boolean;
  music: MusicNotice[];
};

export const NO_NOTICES: MeetingNotices = { assigned: [], moved: false, music: [] };

/** The meeting as an email shows it, taken from what the write stores. */
export type NoticeMeeting = {
  id: string;
  date: string;
  time: string | null;
  arrival: string | null;
  place: string | null;
  title: string | null;
  kind: string | null;
};

/** What the writer hands a route: the notices, the meeting as the emails show it, and who wrote. */
export type EventNoticeEffects = MeetingNotices & { meeting: NoticeMeeting; ministry: "jovenes"; actorId: string };

export function hasNotices(n: MeetingNotices): boolean {
  return n.assigned.length > 0 || n.music.length > 0;
}

const plain = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const refOf = (x: unknown): string | null => (plain(x) && typeof x._ref === "string" && x._ref ? x._ref : null);
const text = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/**
 * A meeting's snapshot from its document fields — the stored row, or the same fields as a write
 * is about to store them. Tolerant: anything malformed reads as absent, never as a person.
 */
export function snapshotOf(row: {
  audience?: unknown;
  published?: unknown;
  date?: unknown;
  seats?: unknown;
  program?: unknown;
}): MeetingSnapshot {
  const seats = (Array.isArray(row.seats) ? row.seats : []).filter(plain).map((s) => ({
    role: typeof s.role === "string" ? s.role : "",
    member: refOf(s.member),
    name: refOf(s.member) ? null : text(s.name),
  }));
  const lines = (Array.isArray(row.program) ? row.program : []).filter(plain).map((l, i) => {
    const members = [refOf(l.member), refOf(l.member2)].filter((m): m is string => m !== null);
    return {
      key: typeof l._key === "string" && l._key ? l._key : `i${i}`,
      part: partSpec(l.part)?.id ?? null,
      label: text(l.label) ?? "",
      members: [...new Set(members)],
      music: isPartMusic(l.music) ? l.music : null,
      note: text(l.note),
    };
  });
  return {
    ministryWide: plain(row.audience) && row.audience.kind === "ministry",
    published: row.published === true,
    date: typeof row.date === "string" ? row.date : "",
    seats,
    lines,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Announced to people: for all of Jóvenes, published, and today or later. */
function live(s: MeetingSnapshot | null, today: string): s is MeetingSnapshot {
  return !!s && s.ministryWide && s.published && ISO_DATE.test(s.date) && s.date >= today;
}

/** Every (member, role) of a meeting, per member, in the order the meeting lists them. */
function rolesByMember(s: MeetingSnapshot): Map<string, AssignedRole[]> {
  const out = new Map<string, AssignedRole[]>();
  const add = (member: string, role: AssignedRole) => {
    const list = out.get(member) ?? [];
    if (!list.some((r) => r.kind === role.kind && r.id === role.id)) list.push(role);
    out.set(member, list);
  };
  for (const seat of s.seats) {
    if (!seat.member || !seat.role) continue;
    const partners = s.seats.filter((x) => x.role === seat.role && x.member && x.member !== seat.member).map((x) => x.member as string);
    add(seat.member, { kind: "seat", id: seat.role, label: seat.role, partners: [...new Set(partners)] });
  }
  for (const line of s.lines) {
    const spec = partSpec(line.part);
    for (const member of line.members) {
      const partners = line.members.filter((m) => m !== member);
      add(member, spec ? { kind: "part", id: spec.id, label: spec.label, partners } : { kind: "line", id: line.key, label: line.label, partners });
    }
  }
  return out;
}

/** The first line of a part (the writer stores at most one). */
function partLine(s: MeetingSnapshot, part: MusicPart): SnapshotLine | null {
  return s.lines.find((l) => l.part === part) ?? null;
}

function asksMusic(s: MeetingSnapshot | null, part: MusicPart, today: string): boolean {
  return live(s, today) && partLine(s, part)?.music === "alabanza";
}

/** Who answers for a part: the line's people, or — for Plática — whoever holds a `comparte` seat. */
function responsables(s: MeetingSnapshot, part: MusicPart): { members: string[]; names: string[] } {
  if (part === "platica") {
    const seats = s.seats.filter((x) => x.role === PLATICA_SEAT);
    return {
      members: [...new Set(seats.map((x) => x.member).filter((m): m is string => m !== null))],
      names: seats.map((x) => x.name).filter((n): n is string => n !== null),
    };
  }
  return { members: partLine(s, part)?.members ?? [], names: [] };
}

/**
 * The notices one write owes. `before` is `null` for a create. `today` is the CDMX calendar day
 * (`YYYY-MM-DD`); `actorId` never hears about their own write.
 */
export function meetingNotices(
  before: MeetingSnapshot | null,
  after: MeetingSnapshot,
  ctx: { actorId: string; today: string },
): MeetingNotices {
  const wasLive = live(before, ctx.today);
  const isLive = live(after, ctx.today);
  const moved = wasLive && isLive && before.date !== after.date;

  const assigned: MeetingNotices["assigned"] = [];
  if (isLive) {
    // A publish, a create already published, or a new date: the whole meeting is news.
    const prior = wasLive ? rolesByMember(before) : new Map<string, AssignedRole[]>();
    for (const [memberId, roles] of rolesByMember(after)) {
      if (memberId === ctx.actorId) continue;
      const had = moved ? [] : (prior.get(memberId) ?? []);
      const fresh = roles.filter((r) => !had.some((h) => h.kind === r.kind && h.id === r.id));
      if (fresh.length > 0) assigned.push({ memberId, roles: fresh, ...(moved && prior.has(memberId) ? { moved: true as const } : {}) });
    }
  }

  const music: MusicNotice[] = [];
  for (const part of ["oracion", "platica"] as const) {
    const asked = asksMusic(before, part, ctx.today);
    const asks = asksMusic(after, part, ctx.today);
    // A request on a re-dated meeting is said again: whoever arranges the music needs the new day.
    if (asks === asked && !(asks && moved)) continue;
    // A withdrawal names whoever still answers for the part; when the write removed them with the
    // line (or the seats), whoever HAD asked — or «ya no piden» would name nobody.
    let who = responsables(after, part);
    if (!asks && before && who.members.length + who.names.length === 0) who = responsables(before, part);
    music.push({ part, asks, note: asks ? (partLine(after, part)?.note ?? null) : null, ...who });
  }

  return { assigned, moved, music };
}
