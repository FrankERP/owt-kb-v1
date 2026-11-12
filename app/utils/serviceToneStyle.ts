// A worship service's day as COLOUR on its card (ADR-0087): the band of the date tile and the
// card's rail — the two parts of ONE device, the day's mark. Nothing else on the card takes the
// hue (ADR-0059's rule stands: an amber wash behind a Saturday read as a warning). The same three hues the agenda has always given the
// week — Saturday amber, Sunday the app's cyan, a special service the info blue (`TONE_RAIL`,
// ADR-0059/0067) — now spelled as the five-part tone the Jóvenes cards read (`AudienceTone`,
// ADR-0086), so `DateTile` draws a service and a meeting with one component.
//
// A tone is the DAY's identity, never a state: «tú» keeps the one green, a warning keeps its
// own amber mark with an icon beside it. Kids and Jóvenes days stay neutral here, as on the
// rail: another ministry's day, not a fourth kind of worship service.
//
// NEUTRAL — no React — so a Server Component may read it (ADR-0028). Every class is spelled
// whole: Tailwind reads this file as text.

import type { Tone } from "./agenda";
import type { AudienceTone } from "./jovenesGroupStyle";

export type ServiceToneStyle = AudienceTone;

export const SERVICE_TONE: Record<Tone, ServiceToneStyle> = {
  sun: {
    chip: "border-accent/30 bg-accent/10 text-accent",
    solid: "bg-accent",
    ink: "text-accent",
    wash: "bg-accent/[0.14]",
    edge: "border-accent",
  },
  sat: {
    chip: "border-warning-fg/30 bg-warning-fg/10 text-warning-fg",
    solid: "bg-warning-fg",
    ink: "text-warning-fg",
    wash: "bg-warning-fg/[0.14]",
    edge: "border-warning-fg",
  },
  special: {
    chip: "border-info-fg/30 bg-info-fg/10 text-info-fg",
    solid: "bg-info-fg",
    ink: "text-info-fg",
    wash: "bg-info-fg/[0.16]",
    edge: "border-info-fg",
  },
  kids: {
    chip: "border-ink/15 bg-ink/[0.06] text-ink-muted",
    solid: "bg-ink-dim",
    ink: "text-ink-muted",
    wash: "bg-ink/[0.08]",
    edge: "border-ink-dim",
  },
  jovenes: {
    chip: "border-ink/15 bg-ink/[0.06] text-ink-muted",
    solid: "bg-ink-muted",
    ink: "text-ink-muted",
    wash: "bg-ink/[0.08]",
    edge: "border-ink-muted",
  },
};

/** The «tú» chip — class for class the one on a Jóvenes card (`MeetingCard`): one signal
 *  on every surface, the app's one green. */
export const MINE_CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg";

/** «En 3 días» as a quiet chip beside it. */
export const COUNTDOWN_CHIP =
  "inline-flex items-center rounded-full border border-ink/[0.16] px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-ink-muted";
