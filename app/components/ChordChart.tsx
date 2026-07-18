"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Chart {
  key: string;
  content: string;
}

interface Segment {
  chord?: string;
  lyric: string;
}

// ─── Transposition ────────────────────────────────────────────────────────────

const DISPLAY_NOTES = [
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
] as const;

const NOTE_INDEX: Record<string, number> = {
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

// Transpose a single note token (root + trailing quality/extensions).
function transposeToken(token: string, semitones: number): string {
  const m = token.match(/^([A-G][b#]?)(.*)/);
  if (!m) return token;
  const [, root, quality] = m;
  const idx = NOTE_INDEX[root];
  if (idx === undefined) return token;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return DISPLAY_NOTES[newIdx] + quality;
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

function rootIndex(key: string): number {
  const m = key.match(/^([A-G][b#]?)/);
  if (!m) return -1;
  return NOTE_INDEX[m[1]] ?? -1;
}

// Open-chord-friendly keys (CAGED): C, A, G, E, D.
const OPEN_KEY_IDX = [0, 9, 7, 4, 2];

// Smallest capo position that lets you play the sounding key with open shapes.
function capoSuggestion(soundingIdx: number): { fret: number; shapeKey: string } | null {
  if (soundingIdx < 0) return null;
  for (let fret = 0; fret <= 11; fret++) {
    const shapeIdx = ((soundingIdx - fret) % 12 + 12) % 12;
    if (OPEN_KEY_IDX.includes(shapeIdx)) return { fret, shapeKey: DISPLAY_NOTES[shapeIdx] };
  }
  return null;
}

// ─── ChordPro parser ─────────────────────────────────────────────────────────

function parseLine(line: string): Segment[] {
  if (!line.includes("[")) return [{ lyric: line }];

  const segments: Segment[] = [];
  let rest = line;

  const firstBracket = rest.indexOf("[");
  if (firstBracket > 0) {
    segments.push({ lyric: rest.slice(0, firstBracket) });
    rest = rest.slice(firstBracket);
  }

  const re = /\[([^\]]+)\]([^[]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    segments.push({ chord: m[1], lyric: m[2] });
  }

  return segments;
}

const CHORD_RE = /\[[^\]]+\]/;

function stripChords(line: string): string {
  return line.replace(/\[[^\]]+\]/g, "");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChordChart({ charts, defaultKey }: { charts: Chart[]; defaultKey?: string }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showChords, setShowChords] = useState(true);
  const [semitones, setSemitones] = useState(() => {
    if (!defaultKey || !charts[0]) return 0;
    const native = rootIndex(charts[0].key);
    const target = rootIndex(defaultKey);
    if (native < 0 || target < 0) return 0;
    return ((target - native) % 12 + 12) % 12;
  });

  if (!charts.length) return null;

  const current = charts[activeIdx];
  const isChordPro = CHORD_RE.test(current.content);
  const nativeIdx = rootIndex(current.key);
  const activeKeyIdx = nativeIdx >= 0 ? ((nativeIdx + semitones) % 12 + 12) % 12 : -1;
  const capo = capoSuggestion(activeKeyIdx);

  const handleTabChange = (i: number) => {
    setActiveIdx(i);
    setSemitones(0);
  };

  const handleKeyBtn = (btnIdx: number) => {
    if (nativeIdx < 0) return;
    setSemitones(((btnIdx - nativeIdx) % 12 + 12) % 12);
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">

      {/* Chart tabs */}
      {charts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {charts.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleTabChange(i)}
              aria-label={`${c.key || `Tonalidad ${i + 1}`} · versión ${i + 1} de ${charts.length}`}
              aria-pressed={i === activeIdx}
              className={`font-label text-xs uppercase tracking-widest px-4 py-1.5 rounded-full border transition-colors ${
                i === activeIdx
                  ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                  : "border-[#003572]/25 dark:border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50 hover:text-[#00bfff]"
              }`}
            >
              {c.key || `Tonalidad ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* ChordPro controls */}
      {isChordPro && (
        <div className="flex flex-col gap-3">

          {/* Transposition keys */}
          {nativeIdx >= 0 && (
            <div className="flex flex-wrap gap-1.5">
              {DISPLAY_NOTES.map((note, i) => {
                const isActive = i === activeKeyIdx;
                const isNative = i === nativeIdx && !isActive;
                const isNativeNote = i === nativeIdx;
                return (
                  <button
                    key={note}
                    type="button"
                    onClick={() => handleKeyBtn(i)}
                    aria-label={`Tonalidad ${note}${isNativeNote ? " (original)" : ""}`}
                    aria-pressed={isActive}
                    className={`relative font-label text-xs uppercase tracking-wide px-2.5 py-1 rounded border transition-colors min-w-[2rem] text-center ${
                      isActive
                        ? "border-[#00bfff] bg-[#00bfff] text-[#001f3f] font-bold"
                        : isNative
                        ? "border-[#00bfff]/60 text-[#00bfff]"
                        : "border-[#003572]/25 dark:border-[#00bfff]/15 text-gray-500 dark:text-gray-500 hover:border-[#00bfff]/50 hover:text-[#00bfff]"
                    }`}
                  >
                    {note}
                    {isNativeNote && !isActive && (
                      <span aria-hidden className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#00bfff]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Capo suggestion */}
          {capo && (
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 font-label text-xs uppercase tracking-wide px-2.5 py-1 rounded-full border border-[#00bfff]/30 text-[#00bfff]/90"
                title="Posición de capo para tocar con acordes abiertos en la tonalidad seleccionada"
              >
                <CapoIcon />
                {capo.fret === 0
                  ? `Acordes abiertos (${capo.shapeKey})`
                  : `Capo ${capo.fret} · formas de ${capo.shapeKey}`}
              </span>
            </div>
          )}

          {/* Chord toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-label="Mostrar acordes"
              aria-checked={showChords}
              onClick={() => setShowChords((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                showChords ? "bg-[#00bfff]" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  showChords ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className="font-label text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400 select-none">
              Acordes
            </span>
          </div>
        </div>
      )}

      {/* Single key badge for non-ChordPro chart */}
      {!isChordPro && charts.length === 1 && current.key && (
        <span className="font-label text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border border-[#00bfff]/40 text-[#00bfff] inline-block">
          {current.key}
        </span>
      )}

      {/* Content */}
      {isChordPro ? (
        <div className="rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 px-5 py-5 overflow-x-auto">
          {current.content.split("\n").map((line, li) => {
            // Section header: # Estribillo
            if (line.startsWith("# ")) {
              return (
                <p
                  key={li}
                  className="font-label text-xs uppercase tracking-widest text-[#00bfff]/70 mt-5 mb-1 first:mt-0"
                >
                  {line.slice(2)}
                </p>
              );
            }

            // Blank line → spacer
            if (!line.trim()) {
              return <div key={li} className="h-1" />;
            }

            const lineHasChords = CHORD_RE.test(line);

            // Plain text line, or chords hidden
            if (!showChords || !lineHasChords) {
              const text = lineHasChords ? stripChords(line) : line;
              if (!text.trim()) return null;
              return (
                <p key={li} className="font-body text-sm sm:text-base leading-snug">
                  {text}
                </p>
              );
            }

            // Chord-above-lyric rendering
            const segments = parseLine(line);
            const allLyricsEmpty = segments.every((s) => !s.lyric.trim());
            return (
              <div key={li} className={`flex flex-wrap leading-none ${allLyricsEmpty ? "mb-0" : "mb-1"}`}>
                {segments.map((seg, si) => (
                  <span key={si} className="inline-block align-top">
                    <span className="block font-mono font-semibold text-[#00bfff] text-sm leading-tight whitespace-nowrap">
                      {seg.chord !== undefined
                        ? transposeChord(seg.chord, semitones)
                        : " "}
                    </span>
                    {seg.lyric.trim() !== "" && (
                      <span className="block font-body text-sm sm:text-base leading-snug whitespace-pre">
                        {seg.lyric}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <pre className="font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 px-5 py-5 overflow-x-auto">
          {current.content}
        </pre>
      )}
    </div>
  );
}

function CapoIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="21" /><line x1="12" y1="3" x2="12" y2="21" /><line x1="18" y1="3" x2="18" y2="21" />
      <rect x="3" y="9" width="18" height="3.5" rx="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
