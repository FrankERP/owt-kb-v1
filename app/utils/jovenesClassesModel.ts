// «Clases del grupo» in Planear Jóvenes (plan `docs/superpowers/plans/2026-11-12-jovenes-group-classes.md`
// §4): a group's class rosters, built from the planner's editor-mode read. Pure and neutral, so the
// screen and its tests share every rule. Nothing here decides access: the reader already chose the
// meetings this person may see, and the writer decides every write again.

import type { MinistryEventView } from "./ministryEventReads";
import { NO_CLASS_TITLE, plusDays, shiftedDate, type LessonTrack } from "./ministryLesson";
import type { PlannerViewer } from "./jovenesPlannerModel";

export type ClassView = MinistryEventView & { lesson: NonNullable<MinistryEventView["lesson"]> };
export type Roster = { series: string; classes: ClassView[]; held: number; total: number; last: string };

/** The groups whose classes this person plans: an admin every group, a leader the ones they lead. */
export function plannableGroups(all: ReadonlyArray<{ id: string; name: string }>, v: PlannerViewer) {
  return v.isManager ? [...all] : all.filter((g) => v.led.includes(g.id));
}

/** Is this meeting one of `group`'s classes? (The reader already applied L0.) */
export function isClassOf(e: MinistryEventView, group: string): e is ClassView {
  return e.lesson !== null && e.audience?.kind === "groups" && e.audience.groups.length === 1 && e.audience.groups[0] === group;
}

const byDate = (a: MinistryEventView, b: MinistryEventView) =>
  a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date < b.date ? -1 : 1;

/**
 * A group's rosters (one per `series`), each by date, ordered so the roster with the next class
 * comes first (then the most recent). `held`/`total` count classes, not «No hubo clase» rows.
 */
export function groupRosters(events: readonly MinistryEventView[], group: string, today: string): Roster[] {
  const by = new Map<string, ClassView[]>();
  for (const e of events) {
    if (!isClassOf(e, group)) continue;
    const list = by.get(e.lesson.series) ?? [];
    list.push(e);
    by.set(e.lesson.series, list);
  }
  const rosters = [...by.entries()].map(([series, list]) => {
    const classes = list.sort(byDate);
    const real = classes.filter((c) => c.lesson.track !== "sin_clase");
    return { series, classes, held: real.filter((c) => c.lesson.done).length, total: real.length, last: classes[classes.length - 1].date };
  });
  const next = (r: Roster) => r.classes.find((c) => c.date >= today)?.date ?? null;
  return rosters.sort((a, b) => {
    const na = next(a);
    const nb = next(b);
    if (na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
    if (na || nb) return na ? -1 : 1;
    return a.last < b.last ? 1 : a.last > b.last ? -1 : 0;
  });
}

/** A roster split for the screen: what already passed (folded) and what is coming, by month. */
export function splitRoster(r: Roster, today: string): { past: ClassView[]; months: Array<{ month: string; classes: ClassView[] }> } {
  const past = r.classes.filter((c) => c.date < today);
  const months: Array<{ month: string; classes: ClassView[] }> = [];
  for (const c of r.classes.filter((x) => x.date >= today)) {
    const m = c.date.slice(0, 7);
    if (months.at(-1)?.month !== m) months.push({ month: m, classes: [] });
    months.at(-1)!.classes.push(c);
  }
  return { past, months };
}

/** The class's responsable: the first «encargado» seat (a member or a typed name such as «Todos»). */
export function responsable(c: Pick<MinistryEventView, "seats">) {
  return c.seats.find((s) => s.role === "encargado") ?? null;
}

// ── «Recorrer» ──────────────────────────────────────────────────────────────

export type ShiftPreview = {
  /** The ids the writer must find (L3 step 8): the anchor and every later CLASS of the roster. */
  ids: string[];
  moves: Array<{ id: string; title: string | null; from: string; to: string }>;
  /** Dates a moved class lands on that already hold another meeting of the group (a warning). */
  collisions: string[];
};

/** What «Recorrer» on `anchor` will do, by the writer's own rule (`shiftedDate`). */
export function shiftPreview(r: Roster, anchor: ClassView, groupEvents: readonly MinistryEventView[]): ShiftPreview {
  const later = r.classes.filter((c) => c.date >= anchor.date);
  const classes = later.filter((c) => c.lesson.track !== "sin_clase");
  const gaps = new Set([anchor.date, ...later.filter((c) => c.lesson.track === "sin_clase").map((c) => c.date)]);
  const moves = classes.map((c) => ({ id: c._id, title: c.title, from: c.date, to: shiftedDate(c.date, gaps) }));
  const moving = new Set(classes.map((c) => c._id));
  const taken = new Set(groupEvents.filter((e) => !moving.has(e._id)).map((e) => e.date));
  // A date already holding another meeting, or two moved classes landing together (possible only
  // when a class and a «No hubo clase» row already shared a date).
  const landed = moves.map((m) => m.to);
  const twice = landed.filter((d, i) => landed.indexOf(d) !== i);
  const collisions = [...new Set(landed.filter((d) => taken.has(d) || twice.includes(d)))];
  return { ids: classes.map((c) => c._id), moves, collisions };
}

/** Classes «Cambiar con…» may trade with: the same roster's other upcoming, not-held classes. */
export function swapCandidates(r: Roster, a: ClassView): ClassView[] {
  return r.classes.filter((c) => c._id !== a._id && !c.lesson.done && c.lesson.track !== "sin_clase");
}

/** May this class be shifted or traded? (The writer refuses held classes and «No hubo clase» rows.) */
export const isOpenClass = (c: ClassView) => !c.lesson.done && c.lesson.track !== "sin_clase";

// ── The class form ──────────────────────────────────────────────────────────

/** Otro Nivel and Invencibles meet at Oasis Tepepan around 11:40 (Frank, 2026-11-12). */
export const CLASS_DEFAULTS: Record<string, { time: string; place: string }> = {
  "otro-nivel": { time: "11:40", place: "Oasis Tepepan" },
  invencibles: { time: "11:40", place: "Oasis Tepepan" },
};

/** A responsable pick: a member, a typed name («Todos»), or nobody. */
export type ResponsablePick = { member: string | null; name: string | null };

export type ClassForm = {
  group: string;
  series: string;
  date: string;
  time: string;
  place: string;
  title: string;
  track: LessonTrack;
  done: boolean;
  responsable: ResponsablePick;
  notes: string;
  published: boolean;
};

export function classForm(group: string, date: string, series: string, c?: ClassView): ClassForm {
  const seat = c ? responsable(c) : null;
  const d = CLASS_DEFAULTS[group];
  return {
    group,
    series: c?.lesson.series ?? series,
    date: c?.date ?? date,
    time: c ? (c.time ?? "") : (d?.time ?? ""),
    place: c ? (c.place ?? "") : (d?.place ?? ""),
    title: c?.title ?? "",
    track: c?.lesson.track ?? "libro",
    done: c?.lesson.done ?? false,
    responsable: { member: seat?.memberId ?? null, name: seat && !seat.memberId ? seat.name : null },
    notes: c?.notes ?? "",
    published: c?.published ?? false,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function classProblem(f: ClassForm): string | null {
  if (!f.series.trim()) return "Escribe el nombre del rol (por ejemplo, el libro).";
  if (f.series.trim().length > 80) return "El nombre del rol es demasiado largo.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return "Elige la fecha.";
  if (f.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) return "La hora debe ser HH:mm, por ejemplo 11:40.";
  if (f.responsable.name !== null && !f.responsable.name.trim()) return "Escribe el nombre o elige a una persona.";
  return null;
}

/**
 * The body of a class create (with `token`) or edit (with `_rev`). The seats are the responsable
 * only; an existing seat's key travels back so an unchanged responsable is kept as it was (W5).
 * A «No hubo clase» row with no title is titled so, so no view shows it as an untitled meeting.
 */
export function classBody(f: ClassForm, keepKey: string | null = null): Record<string, unknown> {
  const title = orNull(f.title) ?? (f.track === "sin_clase" ? NO_CLASS_TITLE : null);
  // A «No hubo clase» row has nobody in charge (its editor hides the field), so it saves no seat.
  const r = f.track === "sin_clase" ? { member: null, name: null } : f.responsable;
  const seat = r.member || (r.name && r.name.trim())
    ? [{ ...(keepKey ? { _key: keepKey } : {}), role: "encargado", ...(r.member ? { member: r.member } : { name: r.name!.trim() }) }]
    : [];
  return {
    audience: { kind: "groups", groups: [f.group] },
    date: f.date,
    time: orNull(f.time),
    place: orNull(f.place),
    title,
    notes: orNull(f.notes),
    published: f.published,
    seats: seat,
    lesson: { series: f.series.trim(), track: f.track, done: f.done },
  };
}

// ── «Nuevo libro» ───────────────────────────────────────────────────────────

/** At most this many classes at once; the writer's «Recorrer» cap (`SHIFT_MAX_ROWS`) is twice it. */
export const MAX_NEW_CLASSES = 60;

export type BookForm = {
  group: string;
  series: string;
  firstChapter: number;
  count: number;
  firstDate: string;
  everyDays: number;
  time: string;
  place: string;
  rotation: ResponsablePick[];
  published: boolean;
};

export function bookForm(group: string, firstDate: string): BookForm {
  const d = CLASS_DEFAULTS[group];
  return {
    group,
    series: "",
    firstChapter: 1,
    count: 10,
    firstDate,
    everyDays: 7,
    time: d?.time ?? "",
    place: d?.place ?? "",
    rotation: [{ member: null, name: null }],
    published: false,
  };
}

export function bookProblem(f: BookForm): string | null {
  if (!f.series.trim()) return "Escribe el nombre del libro.";
  if (f.series.trim().length > 80) return "El nombre del libro es demasiado largo.";
  if (!Number.isInteger(f.firstChapter) || f.firstChapter < 1 || f.firstChapter > 999) return "El primer capítulo debe ser un número.";
  if (!Number.isInteger(f.count) || f.count < 1 || f.count > MAX_NEW_CLASSES) return `Entre 1 y ${MAX_NEW_CLASSES} clases.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.firstDate)) return "Elige la fecha de la primera clase.";
  if (!Number.isInteger(f.everyDays) || f.everyDays < 1 || f.everyDays > 60) return "Cada cuántos días: entre 1 y 60.";
  if (f.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) return "La hora debe ser HH:mm, por ejemplo 11:40.";
  if (f.rotation.some((p) => p.name !== null && !p.name.trim())) return "Escribe el nombre o elige a una persona.";
  return null;
}

/** The classes «Nuevo libro» will create, in order: «Cap N», a date every N days, the rotation. */
export function bookRows(f: BookForm): ClassForm[] {
  const people = f.rotation.length ? f.rotation : [{ member: null, name: null }];
  return Array.from({ length: Math.min(f.count, MAX_NEW_CLASSES) }, (_, i) => ({
    group: f.group,
    series: f.series.trim(),
    date: plusDays(f.firstDate, i * f.everyDays),
    time: f.time,
    place: f.place,
    title: `Cap ${f.firstChapter + i}`,
    track: "libro" as const,
    done: false,
    responsable: people[i % people.length],
    notes: "",
    published: f.published,
  }));
}
