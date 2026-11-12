// Who a Jóvenes meeting is for, as COLOUR and a badge (ADR-0087). Pure and neutral — no React,
// no hooks — so the page (a Server Component) and the planner (client) both call it.
//
// A group's colour is its identity on a meeting: the chip with its monogram, the card's rail, the
// band of the date tile. It is never a state («publicada», «borrador» and «tú» keep green and
// amber) and it decides nothing: access is the reader's (`ministryEventReads.ts`).
//
// Every class is spelled out whole. Tailwind reads this file as text, so `bg-group-${id}` would
// compile to nothing; that is also why a new group needs a row here (`jovenesGroupStyle.test.ts`
// fails until it has one) on top of its five tokens in `brand.css` and `tailwind.config.ts`.

import { MINISTRIES } from "@/app/ministries";
import type { MinistryEventView } from "./ministryEventReads";

export type AudienceTone = {
  /** A chip: tinted fill, hairline and ink of the one hue. */
  chip: string;
  /** The solid hue: a rail segment, a dot. */
  solid: string;
  /** The hue as ink on the card (a monogram, a date tile's weekday). */
  ink: string;
  /** A wash behind that ink (the date tile's band, an icon tile). */
  wash: string;
  /** The hue as an outline: a hollow dot, for a draft on the month map. */
  edge: string;
};

/** All of Jóvenes: the app's own accent, the colour of «the whole thing». */
export const MINISTRY_TONE: AudienceTone = {
  chip: "border-accent/30 bg-accent/10 text-accent",
  solid: "bg-accent",
  ink: "text-accent",
  wash: "bg-accent/[0.14]",
  edge: "border-accent",
};

/** A group id the registry does not know (a retired group still stored on a meeting): neutral. */
export const UNKNOWN_TONE: AudienceTone = {
  chip: "border-ink/15 bg-ink/[0.06] text-ink-muted",
  solid: "bg-ink-dim",
  ink: "text-ink-muted",
  wash: "bg-ink/[0.08]",
  edge: "border-ink-dim",
};

export const GROUP_TONE: Record<string, AudienceTone> = {
  "otro-nivel": {
    chip: "border-group-otro-nivel/35 bg-group-otro-nivel/[0.14] text-group-otro-nivel",
    solid: "bg-group-otro-nivel",
    ink: "text-group-otro-nivel",
    wash: "bg-group-otro-nivel/[0.16]",
    edge: "border-group-otro-nivel",
  },
  invencibles: {
    chip: "border-group-invencibles/35 bg-group-invencibles/[0.14] text-group-invencibles",
    solid: "bg-group-invencibles",
    ink: "text-group-invencibles",
    wash: "bg-group-invencibles/[0.16]",
    edge: "border-group-invencibles",
  },
  emprendedores: {
    chip: "border-group-emprendedores/35 bg-group-emprendedores/[0.14] text-group-emprendedores",
    solid: "bg-group-emprendedores",
    ink: "text-group-emprendedores",
    wash: "bg-group-emprendedores/[0.16]",
    edge: "border-group-emprendedores",
  },
  adrenalin: {
    chip: "border-group-adrenalin/35 bg-group-adrenalin/[0.14] text-group-adrenalin",
    solid: "bg-group-adrenalin",
    ink: "text-group-adrenalin",
    wash: "bg-group-adrenalin/[0.16]",
    edge: "border-group-adrenalin",
  },
  guerreras: {
    chip: "border-group-guerreras/35 bg-group-guerreras/[0.14] text-group-guerreras",
    solid: "bg-group-guerreras",
    ink: "text-group-guerreras",
    wash: "bg-group-guerreras/[0.16]",
    edge: "border-group-guerreras",
  },
};

const GROUP_NAME = new Map<string, string>(MINISTRIES.jovenes.groups.map((g) => [g.id, g.name]));

/** Own keys only: a stored `"constructor"` must not reach `Object.prototype`. */
export function groupTone(id: string): AudienceTone {
  return Object.hasOwn(GROUP_TONE, id) ? GROUP_TONE[id] : UNKNOWN_TONE;
}

/**
 * Two capitals that stand for a group inside its chip, so the colour is never the only thing
 * that tells two groups apart: the initials of a two-word name («Otro Nivel» → ON), else the
 * first two letters («Guerreras» → GU).
 */
export function groupMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toLocaleUpperCase("es");
}

export type AudienceBadge = {
  key: string;
  label: string;
  /** `null` for the whole ministry, whose chip carries an icon instead. */
  monogram: string | null;
  tone: AudienceTone;
};

type Audience = MinistryEventView["audience"];

/**
 * One badge per group the meeting is for, or the one «Todo Jóvenes». The words are
 * `audienceLabel`'s (`jovenesEventView.ts`), split per group: an unknown id shows as itself.
 */
export function audienceBadges(audience: Audience): AudienceBadge[] {
  if (!audience) return [{ key: "none", label: "Sin audiencia", monogram: null, tone: UNKNOWN_TONE }];
  if (audience.kind === "ministry") return [{ key: "ministry", label: "Todo Jóvenes", monogram: null, tone: MINISTRY_TONE }];
  if (audience.groups.length === 0) return [{ key: "none", label: "Sin grupos", monogram: null, tone: UNKNOWN_TONE }];
  return [...new Set(audience.groups)].map((id) => {
    const label = GROUP_NAME.get(id) ?? id;
    return { key: id, label, monogram: groupMonogram(label), tone: groupTone(id) };
  });
}

/** The meeting's leading tone: the whole ministry's, or its first group's (the date tile's band). */
export function audienceTone(audience: Audience): AudienceTone {
  return audienceBadges(audience)[0].tone;
}

/** The card's rail, top to bottom: one solid segment per group of a shared meeting. */
export function audienceRail(audience: Audience): string[] {
  return audienceBadges(audience).map((b) => b.tone.solid);
}
