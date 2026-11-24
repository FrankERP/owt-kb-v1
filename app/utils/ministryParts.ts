// THE ONE DEFINITION of a Jóvenes meeting's fixed parts (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` M0).
//
// Frank, 2026-11-17: «La reunión siempre tiene la misma estructura: Alabanza, Oración, Dinámica 1
// y Dinámica 2, Plática». A part is a program line that carries `part`; the table below says how
// many people it holds and which extra fields its responsable fills. Alabanza is NOT here: it is
// never stored, it is that Saturday's worship setlist (`jovenesWorshipSet.ts`).
//
// NEUTRAL — no server, client or Sanity import — because the writer (`ministryEventCommit.ts`),
// the reader (`ministryEventReads.ts`), the email builders and the screens all read this table,
// so they can never disagree about what «Dinámica 1» holds.

export const PART_IDS = ["oracion", "dinamica1", "dinamica2", "platica"] as const;
export type PartId = (typeof PART_IDS)[number];

export const PART_MUSIC = ["track", "alabanza"] as const;
export type PartMusic = (typeof PART_MUSIC)[number];

export type PartSpec = {
  id: PartId;
  label: string;
  /** People stored ON the line. Plática holds none: its people are the `comparte` seats. */
  people: 0 | 1 | 2;
  /** The responsable says whether they want a track or someone from the worship team. */
  music: boolean;
  /** The responsable names the youths who will help («Jóvenes que apoyan»). */
  helpers: boolean;
};

const SPECS: Record<PartId, PartSpec> = {
  oracion: { id: "oracion", label: "Oración", people: 1, music: true, helpers: false },
  dinamica1: { id: "dinamica1", label: "Dinámica 1", people: 2, music: false, helpers: true },
  dinamica2: { id: "dinamica2", label: "Dinámica 2", people: 2, music: false, helpers: true },
  platica: { id: "platica", label: "Plática", people: 0, music: true, helpers: false },
};

/** The parts in the order the meeting runs them (after Alabanza). */
export const MEETING_PARTS: readonly PartSpec[] = PART_IDS.map((id) => SPECS[id]);

/** The seat whose holders are Plática's people (plan D2: never stored a second time on a line). */
export const PLATICA_SEAT = "comparte";

/** `helpers` is one line of names; a part's description is the line's `note` (300, the writer's). */
export const PART_LIMITS = { helpers: 120, note: 300 } as const;

/** A part's rules, by OWN key: a stored `"constructor"` or `"toString"` is no part. */
export function partSpec(id: unknown): PartSpec | null {
  return typeof id === "string" && Object.hasOwn(SPECS, id) ? SPECS[id as PartId] : null;
}

export function isPartMusic(v: unknown): v is PartMusic {
  return typeof v === "string" && (PART_MUSIC as readonly string[]).includes(v);
}

/** The label of the virtual first step. */
export const ALABANZA_LABEL = "Alabanza";

/**
 * Does this meeting ALWAYS show the five steps, filled or not? Only the Saturday meeting (D1). A
 * part line stored on any other meeting is still shown, as itself (`jovenesPartView.ts`), so a
 * part is never stored and invisible; that meeting just gets no empty steps and no Alabanza.
 */
export function hasFixedProgram(e: { kind: string | null }): boolean {
  return e.kind === "saturday";
}

/** What each music choice means on each part, in the words the screens and the emails share. */
export const MUSIC_WORDS: Record<"oracion" | "platica", Record<PartMusic, { option: string; chip: string }>> = {
  oracion: {
    track: { option: "Con track", chip: "Track" },
    alabanza: { option: "Que toque alguien de alabanza", chip: "Pide alabanza" },
  },
  platica: {
    track: { option: "Track al final", chip: "Track al final" },
    alabanza: { option: "Canción con el grupo de alabanza", chip: "Pide canción con alabanza" },
  },
};

/** The chip a part shows for its music choice, or `null` (no choice, or a part without music). */
export function musicChip(part: unknown, music: unknown): string | null {
  if ((part !== "oracion" && part !== "platica") || !isPartMusic(music)) return null;
  return MUSIC_WORDS[part][music].chip;
}

/** What a responsable is asked to fill, by part: the email and the form's hint say the same. */
export const PART_ASK: Record<PartId, string> = {
  oracion: "Di si quieres música de un track o que toque alguien de alabanza, y deja una nota breve si hace falta.",
  dinamica1: "Escribe una breve descripción de la dinámica (máximo 300 caracteres) y, si te apoyará algún joven del grupo, su nombre.",
  dinamica2: "Escribe una breve descripción de la dinámica (máximo 300 caracteres) y, si te apoyará algún joven del grupo, su nombre.",
  platica: "Escribe tu tema y di si al final quieres música de un track o una canción con el grupo de alabanza.",
};
