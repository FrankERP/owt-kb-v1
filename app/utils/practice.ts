// Neutral module: no "use client", no imports. Practice-mode maths (tempo
// pill, autoscroll speed, lyric-line count) shared across the song page.

export const DEFAULT_BPM = 80;
export const BEATS_PER_LINE = 8;
export const AUTOSCROLL_MIN = 8; // px/s
export const AUTOSCROLL_MAX = 160; // px/s

/** Period of one beat, ms — the tempo pill's `--tempo-period`. Falsy/≤0 bpm → DEFAULT_BPM. */
export function tempoPeriodMs(bpm: number | null | undefined): number {
  const effective = bpm && bpm > 0 ? bpm : DEFAULT_BPM;
  return 60000 / effective;
}

/** Beats in one bar — the numerator of "4/4" | "6/8" | "3/4". Anything unparsable → 4. */
export function beatsPerBar(timeSig: string | null | undefined): number {
  const numerator = Number((timeSig ?? "").split("/")[0]);
  return Number.isFinite(numerator) && numerator > 0 ? Math.round(numerator) : 4;
}

/** Autoscroll speed in px/s for a section `heightPx` tall with `lines` lyric lines at `bpm`. */
export function autoscrollPxPerSecond(heightPx: number, lines: number, bpm: number | null | undefined): number {
  const effective = bpm && bpm > 0 ? bpm : DEFAULT_BPM;
  const durationSeconds = (lines * BEATS_PER_LINE * 60) / effective;
  const speed = durationSeconds > 0 ? heightPx / durationSeconds : 0;
  return Math.min(AUTOSCROLL_MAX, Math.max(AUTOSCROLL_MIN, speed));
}

/** Lines a lyrics body / ChordPro chart will paint — counts non-blank, non-heading lines. */
export function countLyricLines(text: string): number {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("# ")).length;
}
