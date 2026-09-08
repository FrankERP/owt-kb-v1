// The JS half of the motion tokens (spec §2.3). Plain objects, NO `motion` import:
// this module is neutral so a Server Component may import a constant from it
// (ADR-0028), and so the import boundary in motionImportBoundary.test.ts has one
// fewer allowed importer to reason about. Consumers under app/components/ui pass
// these straight to `m.*` props.
//
// Durations here are the same values as --motion-* in brand.css, in ms, because
// motion takes seconds/ms and cannot read a CSS var.

export const MS = {
  fast: 120,
  base: 200,
  slow: 320,
  reveal: 480,
} as const;

/** Exit is always faster than enter (spec §2.2 "enter fast, exit faster"). */
export const EXIT_MS = 160;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const SPRINGS = {
  /** Bottom sheets and the audio transport. */
  sheet: { type: "spring", stiffness: 380, damping: 36, mass: 0.9 },
  /** Badges, chips, "you" rings — a quick settle with a little overshoot. */
  pop: { type: "spring", stiffness: 520, damping: 30 },
  /** A dragged chip landing. */
  settle: { type: "spring", stiffness: 300, damping: 28 },
} as const;

type Phase = Record<string, number>;
export type Variant = { initial: Phase; animate: Phase; exit: Phase };

/** Only opacity and transform-family keys — the compositor rule (spec §2.2). */
export const VARIANTS = {
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  rise: { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 } },
  scale: { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } },
  /** y in percent of own height is expressed by the consumer via `style`; here y is px. */
  sheet: { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 24 } },
} as const satisfies Record<string, Variant>;

export type VariantName = keyof typeof VARIANTS;
