// The pull-to-refresh arithmetic (spec §12.8, decision L), kept neutral and
// apart from the component: the gesture cannot be driven with any fidelity in
// jsdom (no layout, no real touch), so the numbers are the part that is
// genuinely provable — see `__tests__/pullModel.test.ts`.

/** The travel that commits to a refresh, in CSS px of finger movement. */
export const THRESHOLD = 72;

/** Past this the pull stops registering — the rail is already at full height. */
export const MAX = 120;

/** 0…1 — how far the pull is towards committing. Clamped at both ends. */
export function pullProgress(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(Math.min(dy, MAX) / THRESHOLD, 1);
}

/** Whether a released pull commits to `router.refresh()`. */
export function shouldRefresh(dy: number): boolean {
  return dy >= THRESHOLD;
}

/**
 * The rail's height in px. It grows at HALF the finger's travel — that gap
 * between the finger and the indicator is what reads as resistance, the same
 * way an iOS rubber band does — and caps at `MAX / 2` = 60 px.
 */
export function railHeight(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(dy, MAX) * 0.5;
}
