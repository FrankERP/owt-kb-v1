"use client";

import { useState } from "react";
import SegmentedControl from "./ui/SegmentedControl";
import Switch from "./ui/Switch";
import NumberRoll from "./ui/NumberRoll";
import Presence from "./ui/Presence";
import Button from "./ui/Button";
import { useTransposeOptional } from "./song/TransposeProvider";
import { rootIndex, transposeChord, transposeKey, capoSuggestion, CHORD_RE } from "@/app/utils/transpose";
import { dimRepeatMarkers, LYRIC_EYEBROW } from "@/app/utils/lyricMarkers";

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
  // One seat per page when a provider is present (R4 ruling 2): the hero owns the
  // key picker, this component only steps it. Without a provider — the practice
  // sheet, the admin preview — the chart keeps its own state and the `defaultKey`
  // seed, which a provider-fed page expresses through the picker instead.
  const shared = useTransposeOptional();
  const [localSemitones, setLocalSemitones] = useState(() => {
    if (!defaultKey || !charts[0]) return 0;
    const native = rootIndex(charts[0].key);
    const target = rootIndex(defaultKey);
    if (native < 0 || target < 0) return 0;
    return ((target - native) % 12 + 12) % 12;
  });

  const semitones = shared ? shared.semitones : localSemitones;
  const setSemitones = (n: number) => {
    if (shared) shared.setSemitones(n);
    else setLocalSemitones(((n % 12) + 12) % 12);
  };

  if (!charts.length) return null;

  const current = charts[activeIdx];
  const isChordPro = CHORD_RE.test(current.content);
  const nativeIdx = rootIndex(current.key);
  const activeKeyIdx = nativeIdx >= 0 ? ((nativeIdx + semitones) % 12 + 12) % 12 : -1;
  const capo = capoSuggestion(activeKeyIdx);
  const soundingChartKey = transposeKey(current.key, semitones);

  const handleTabChange = (i: number) => {
    setActiveIdx(i);
    setSemitones(0);
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

          {/* Transposition: one step at a time, reading out the sounding key */}
          {nativeIdx >= 0 && (
            <div className="flex items-center gap-2">
              <Button variant="icon" size="lg" aria-label="Bajar medio tono" onClick={() => setSemitones(semitones - 1)}>
                <MinusIcon />
              </Button>
              <span className="brand-key-dial px-3 font-display text-sm" aria-live="polite">
                <NumberRoll value={soundingChartKey} />
              </span>
              <Button variant="icon" size="lg" aria-label="Subir medio tono" onClick={() => setSemitones(semitones + 1)}>
                <PlusIcon />
              </Button>
              <Presence show={semitones !== 0} variant="fade" as="div">
                <Button variant="pill" size="sm" onClick={() => setSemitones(0)}>
                  Original
                </Button>
              </Presence>
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

      {/* Content. The key remounts the chart on every transposition so the CSS fade
          replays — a plain animation, not `motion`, keeps this file outside the
          motion import boundary. */}
      {isChordPro ? (
        <div
          key={`${activeIdx}-${semitones}`}
          className="rounded-xl border border-edge-accent-subtle bg-accent/5 px-5 py-5 overflow-x-auto animate-fade-in"
        >
          {current.content.split("\n").map((line, li) => {
            // Section header: # Estribillo
            if (line.startsWith("# ")) {
              return (
                <p
                  key={li}
                  className={`${LYRIC_EYEBROW} mt-5 mb-1 first:mt-0`}
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
                  {dimRepeatMarkers(text)}
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

function MinusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <line x1="1" y1="6" x2="11" y2="6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <line x1="1" y1="6" x2="11" y2="6" /><line x1="6" y1="1" x2="6" y2="11" />
    </svg>
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
