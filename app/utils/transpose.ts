// Neutral module: no "use client", no imports. Chord/key transposition maths
// shared by ChordChart (client) and any future server-side reader.

export const DISPLAY_NOTES = [
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
] as const;

export type Note = (typeof DISPLAY_NOTES)[number];

export const NOTE_INDEX: Record<string, number> = {
  C: 0, "B#": 0,
  "C#": 1, Db: 1,
  D: 2,
  "D#": 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, "E#": 5,
  "F#": 6, Gb: 6,
  G: 7,
  "G#": 8, Ab: 8,
  A: 9,
  "A#": 10, Bb: 10,
  B: 11, Cb: 11,
};

export function rootIndex(key: string): number {
  const m = key.match(/^([A-G][b#]?)/);
  if (!m) return -1;
  return NOTE_INDEX[m[1]] ?? -1;
}

export function noteAt(index: number): Note {
  return DISPLAY_NOTES[((index % 12) + 12) % 12];
}

export function semitonesBetween(fromKey: string, toKey: string): number {
  const from = rootIndex(fromKey);
  const to = rootIndex(toKey);
  if (from < 0 || to < 0) return 0;
  return ((to - from) % 12 + 12) % 12;
}

export function transposeKey(key: string, semitones: number): string {
  // At rest the key keeps the spelling the song was written in: `DISPLAY_NOTES`
  // is one enharmonic choice per pitch, so round-tripping a `Db` through it
  // would re-spell an untransposed song as `C#`. Mirrors `transposeChord`.
  if (semitones === 0) return key;
  const m = key.match(/^([A-G][b#]?)(.*)/);
  if (!m) return key;
  const [, root, quality] = m;
  const idx = NOTE_INDEX[root];
  if (idx === undefined) return key;
  return noteAt(idx + semitones) + quality;
}

// Transpose a single note token (root + trailing quality/extensions).
function transposeToken(token: string, semitones: number): string {
  const m = token.match(/^([A-G][b#]?)(.*)/);
  if (!m) return token;
  const [, root, quality] = m;
  const idx = NOTE_INDEX[root];
  if (idx === undefined) return token;
  return noteAt(idx + semitones) + quality;
}

export function transposeChord(chord: string, semitones: number): string {
  if (semitones === 0) return chord;
  // Transpose each side of a slash chord independently (e.g. "G/B" -> "A/C#")
  // so the bass note moves with the root instead of being left behind.
  return chord
    .split("/")
    .map((part) => transposeToken(part, semitones))
    .join("/");
}

// Open-chord-friendly keys (CAGED): C, A, G, E, D.
const OPEN_KEY_IDX = [0, 9, 7, 4, 2];

// Smallest capo position that lets you play the sounding key with open shapes.
export function capoSuggestion(soundingIdx: number): { fret: number; shapeKey: Note } | null {
  if (soundingIdx < 0) return null;
  for (let fret = 0; fret <= 11; fret++) {
    const shapeIdx = ((soundingIdx - fret) % 12 + 12) % 12;
    if (OPEN_KEY_IDX.includes(shapeIdx)) return { fret, shapeKey: DISPLAY_NOTES[shapeIdx] };
  }
  return null;
}

export const CHORD_RE = /\[[^\]]+\]/;

export function isChordPro(content: string): boolean {
  return CHORD_RE.test(content);
}
