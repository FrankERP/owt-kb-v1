// What a write to a group's CLASSES owes by email («Clases del grupo»; Frank, 2026-11-25: «que los
// pastores de Otro Nivel reciban notificaciones por correo sobre sus clases y cambios en el rol»).
// ADR-0089, addendum of 2026-11-25.
//
// PURE and NEUTRAL, like `ministryEventNotices.ts` (whose meetings it never touches: a class is a
// one-group meeting, which that module announces nothing about on purpose). The writer
// (`ministryEventCommit.ts`) builds `before` from the rows it read BEFORE its commit — the exact
// state the write replaces, since every write asserts each row's revision — and `after` from the
// fields it stores, then calls `classNotices`. Nothing is re-read after the commit.
//
// THE AUDIENCE: only the people whose OWN class the write changed — the member ids in a class's
// seats — and only for a class that is published, a real class (not a «No hubo clase» row) and
// today or later. One notice per person per write, however many of their classes it touched, so a
// «Recorrer» of ten classes is at most one email per responsable, never one per class. Never a
// group, never a typed name («Todos»), never the person who made the change.

import { TRACK_LABEL, lessonOf, singleGroup } from "./ministryLesson";

/** A class as a notice reads it: what its email shows, and who holds it. */
export type ClassLine = {
  id: string;
  group: string;
  series: string;
  /** The class's title («Cap 6»), else its track's name («Corazón»). Typed text: never in a subject. */
  label: string;
  date: string;
  time: string | null;
  place: string | null;
};
export type ClassSnap = ClassLine & { members: string[] };

export type ClassChange =
  | { kind: "added"; now: ClassLine }
  | { kind: "changed"; now: ClassLine; was: ClassLine }
  | { kind: "removed"; was: ClassLine };

export type ClassNotice = { memberId: string; changes: ClassChange[] };

/** What a write hands its route: who hears, and who wrote (never told about their own write). */
export type ClassNoticeEffects = { ministry: "jovenes"; actorId: string; notices: ClassNotice[] };

const plain = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored (or about-to-be-stored) row as a class notice reads it, or `null` when it is not an
 * ANNOUNCED class: a valid lesson on a one-group meeting (L0), a real class (not «No hubo
 * clase»), published, with a calendar date. Tolerant: anything malformed reads as absent.
 */
export function classSnapOf(row: {
  _id?: unknown;
  audience?: unknown;
  lesson?: unknown;
  published?: unknown;
  date?: unknown;
  time?: unknown;
  place?: unknown;
  title?: unknown;
  seats?: unknown;
}): ClassSnap | null {
  const group = singleGroup(row.audience);
  const lesson = lessonOf(row.audience, row.lesson);
  if (!group || !lesson || lesson.track === "sin_clase" || row.published !== true) return null;
  if (typeof row._id !== "string" || !row._id || typeof row.date !== "string" || !ISO_DATE.test(row.date)) return null;
  const members = (Array.isArray(row.seats) ? row.seats : [])
    .filter(plain)
    .map((s) => (plain(s.member) && typeof s.member._ref === "string" && s.member._ref ? s.member._ref : null))
    .filter((m): m is string => m !== null);
  return {
    id: row._id,
    group,
    series: lesson.series,
    label: text(row.title) ?? TRACK_LABEL[lesson.track],
    date: row.date,
    time: text(row.time),
    place: text(row.place),
    members: [...new Set(members)],
  };
}

const lineOf = ({ members: _members, ...line }: ClassSnap): ClassLine => line;

/** What a holder would notice: the day, the hour, the place, which class or which roster. */
function differs(a: ClassLine, b: ClassLine): boolean {
  return a.date !== b.date || a.time !== b.time || a.place !== b.place || a.label !== b.label || a.series !== b.series || a.group !== b.group;
}

const changeDate = (c: ClassChange) => (c.kind === "removed" ? c.was.date : c.now.date);

/**
 * The notices one write owes. `before` and `after` are the classes the write touched, as
 * `classSnapOf` read them (`null` for a row that is not an announced class); a create has no
 * `before`, a delete no `after`. `today` is the CDMX calendar day: a class before it is history and
 * owes nothing. In date order per person; people in the order they first appear.
 */
export function classNotices(
  before: ReadonlyArray<ClassSnap | null>,
  after: ReadonlyArray<ClassSnap | null>,
  ctx: { actorId: string; today: string },
): ClassNotice[] {
  const live = (s: ClassSnap | null): s is ClassSnap => s !== null && s.date >= ctx.today;
  const was = new Map(before.filter(live).map((s) => [s.id, s]));
  const now = new Map(after.filter(live).map((s) => [s.id, s]));
  const ids = [...new Set([...was.keys(), ...now.keys()])];

  const out = new Map<string, ClassChange[]>();
  const add = (memberId: string, change: ClassChange) => {
    if (memberId === ctx.actorId) return;
    out.set(memberId, [...(out.get(memberId) ?? []), change]);
  };
  for (const id of ids) {
    const b = was.get(id) ?? null;
    const a = now.get(id) ?? null;
    const people = [...new Set([...(b?.members ?? []), ...(a?.members ?? [])])];
    for (const m of people) {
      const held = !!b && b.members.includes(m);
      const holds = !!a && a.members.includes(m);
      if (holds && !held) add(m, { kind: "added", now: lineOf(a) });
      else if (held && !holds) add(m, { kind: "removed", was: lineOf(b) });
      else if (held && holds && differs(lineOf(b), lineOf(a))) add(m, { kind: "changed", now: lineOf(a), was: lineOf(b) });
    }
  }
  return [...out].map(([memberId, changes]) => ({
    memberId,
    changes: [...changes].sort((x, y) => changeDate(x).localeCompare(changeDate(y))),
  }));
}
