// A Jóvenes group's class («Clases del grupo», plan
// `docs/superpowers/plans/2026-11-12-jovenes-group-classes.md` §3 L0). A class is a `ministryEvent`
// that carries a `lesson`: the roster it belongs to (`series`, the book), its track and whether it
// was held. Pure and neutral: the ONE definition of a valid lesson, used by the writer's parser and
// its «Recorrer» re-check and by the reader's normalization alike, so the two can never disagree
// about which meetings belong to a roster (a disagreement would be a permanent 409 on the shift).
//
// Nothing here decides access: who reads or writes a class is the meeting's own rule (ADR-0081).

export const LESSON_TYPE = "ministryEventLesson";
export const LESSON_TRACKS = ["libro", "corazon", "sin_clase"] as const;
export type LessonTrack = (typeof LESSON_TRACKS)[number];
export type Lesson = { series: string; track: LessonTrack; done: boolean };

export const LESSON_SERIES_MAX = 80;
const LINE_BREAK = /[\r\n\u2028\u2029]/;

export const TRACK_LABEL: Record<LessonTrack, string> = {
  libro: "Libro",
  corazon: "Corazón",
  sin_clase: "No hubo clase",
};

/** Frank's words for a «Corazón» class (2026-11-12), the help under the track picker. */
export const CORAZON_HELP =
  "Un mensaje que no está basado en el libro, sino en lo que Dios haya hablado a tu corazón en las semanas previas.";

/** The title a «No hubo clase» row carries, so no view shows it as an untitled meeting. */
export const NO_CLASS_TITLE = "No hubo clase";

const plain = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A roster name as stored: one line, trimmed, 1–80 characters; anything else is `null`. */
export function seriesName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > LESSON_SERIES_MAX || LINE_BREAK.test(t)) return null;
  return t;
}

/**
 * The lesson a STORED or REQUESTED object holds, or `null` when it is not a valid one. Valid: a
 * plain object whose keys are a subset of `series`, `track`, `done` and `_type`, with the first
 * three present — `series` as `seriesName` keeps it (and already trimmed: a stored value with
 * outer spaces is not one the writer wrote), `track` one of `LESSON_TRACKS`, `done` a boolean —
 * and `_type`, when present, `ministryEventLesson`.
 */
export function parseLesson(raw: unknown): Lesson | null {
  if (!plain(raw)) return null;
  for (const k of Object.keys(raw)) if (!["series", "track", "done", "_type"].includes(k)) return null;
  if (Object.hasOwn(raw, "_type") && raw._type !== LESSON_TYPE) return null;
  const series = seriesName(raw.series);
  if (series === null || series !== raw.series) return null;
  if (typeof raw.track !== "string" || !(LESSON_TRACKS as readonly string[]).includes(raw.track)) return null;
  if (typeof raw.done !== "boolean") return null;
  return { series, track: raw.track as LessonTrack, done: raw.done };
}

/** The single group of a `groups` audience with exactly one entry, else `null` (L0). */
export function singleGroup(audience: unknown): string | null {
  if (!plain(audience) || audience.kind !== "groups" || !Array.isArray(audience.groups)) return null;
  return audience.groups.length === 1 && typeof audience.groups[0] === "string" ? audience.groups[0] : null;
}

/**
 * L0 as every reader applies it: a meeting is a class only when its lesson is valid AND its
 * audience is one group. A lesson left on a shared meeting by older code is ignored, never shown.
 */
export function lessonOf(audience: unknown, raw: unknown): Lesson | null {
  return singleGroup(audience) === null ? null : parseLesson(raw);
}

/** What the writer stores for a lesson it validated. */
export function lessonDoc(l: Lesson): { _type: typeof LESSON_TYPE } & Lesson {
  return { _type: LESSON_TYPE, series: l.series, track: l.track, done: l.done };
}

/** `YYYY-MM-DD` plus whole days, in UTC calendar arithmetic (never local time). */
export function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * «Recorrer»'s date rule (L3 step 11): a week later, and another week while that date is a gap
 * (a «No hubo clase» date of the roster). `gaps` must not be unbounded upward in practice: a
 * roster holds at most 60 rows, so the loop ends.
 */
export function shiftedDate(date: string, gaps: ReadonlySet<string>): string {
  let next = plusDays(date, 7);
  for (let i = 0; i < 70 && gaps.has(next); i++) next = plusDays(next, 7);
  return next;
}
