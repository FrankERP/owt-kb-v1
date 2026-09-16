"use client";

import { useState } from "react";
import SegmentedControl from "./ui/SegmentedControl";
import Switch from "./ui/Switch";
import NumberRoll from "./ui/NumberRoll";
import { DISPLAY_NOTES, rootIndex, transposeChord, capoSuggestion, CHORD_RE } from "@/app/utils/transpose";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Chart {
  key: string;
  content: string;
}

interface Segment {
  chord?: string;
  lyric: string;
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
        <SegmentedControl
          label="Versión"
          value={String(activeIdx)}
          onChange={(v) => handleTabChange(Number(v))}
          options={charts.map((c, i) => ({
            value: String(i),
            label: c.key || `Tonalidad ${i + 1}`,
            ariaLabel: `${c.key || `Tonalidad ${i + 1}`} · versión ${i + 1} de ${charts.length}`,
          }))}
        />
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
                        ? "border-accent bg-accent text-surface-sunken font-bold"
                        : isNative
                        ? "border-accent/60 text-accent"
                        : "border-surface-accent-l25-d15 text-mono-500 dark:text-mono-500 hover:border-accent/50 dark:hover:border-surface-accent-l25-d15 hover:text-accent"
                    }`}
                  >
                    {note}
                    {isNativeNote && !isActive && (
                      <span aria-hidden className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
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
                className="inline-flex items-center gap-1.5 font-label text-xs uppercase tracking-wide px-2.5 py-1 rounded-full border border-accent/30 text-accent/90"
                title="Posición de capo para tocar con acordes abiertos en la tonalidad seleccionada"
              >
                <CapoIcon />
                <NumberRoll value={capo.fret === 0 ? `Acordes abiertos (${capo.shapeKey})` : `Capo ${capo.fret} · formas de ${capo.shapeKey}`} />
              </span>
            </div>
          )}

          {/* Chord toggle */}
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              aria-label="Mostrar acordes"
              checked={showChords}
              onChange={setShowChords}
            />
            <span className="font-label text-xs uppercase tracking-widest text-mono-500 dark:text-mono-400 select-none">
              Acordes
            </span>
          </div>
        </div>
      )}

      {/* Single key badge for non-ChordPro chart */}
      {!isChordPro && charts.length === 1 && current.key && (
        <span className="font-label text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border border-accent/40 text-accent inline-block">
          {current.key}
        </span>
      )}

      {/* Content */}
      {isChordPro ? (
        <div className="rounded-xl border border-edge-accent-subtle bg-accent/5 px-5 py-5 overflow-x-auto">
          {current.content.split("\n").map((line, li) => {
            // Section header: # Estribillo
            if (line.startsWith("# ")) {
              return (
                <p
                  key={li}
                  className="font-label text-xs uppercase tracking-widest text-accent/70 mt-5 mb-1 first:mt-0"
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
                    <span className="block font-mono font-semibold text-accent text-sm leading-tight whitespace-nowrap">
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
        <pre className="font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words rounded-xl border border-edge-accent-subtle bg-accent/5 px-5 py-5 overflow-x-auto">
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
