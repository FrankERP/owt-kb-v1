"use client";

import type React from "react";
import { formatKey } from "@/app/utils/formatKey";
import { ExternalLinkIcon } from "./ui/icons";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PortableText } from "next-sanity";
import type { PortableTextComponents } from "@portabletext/react";
import { usePlayer, AudioTrack, SongHistoryEntry } from "@/app/context/PlayerContext";
import AudioTransport from "./AudioTransport";
import ChordChart from "./ChordChart";
import RehearsalPlayer from "./song/RehearsalPlayer";
import TempoPill from "./song/TempoPill";
import CueDialog from "./ui/CueDialog";
import { groupBySections } from "@/app/utils/lyrics";
import { LYRIC_EYEBROW } from "@/app/utils/lyricMarkers";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { splitSongTitle } from "@/app/utils/songTitle";
import { formatHistoryDate } from "@/app/utils/historyDate";
import Button from "./ui/Button";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

// The sheet is the song page's system at sheet size (ADR-0070's Biblioteca pass):
// the original name beside the artist, the key / BPM / compás as 48 px rings, the
// ONE uppercase on `SHEET_TITLE`, hairline rows for tracks, chord PDFs and the
// history, and «Ver la página completa» as the last row. The key wears the second
// brand colour (`text-key-fg`, ADR-0071).
const RING = "inline-flex min-h-[48px] items-center rounded-full border border-ink/[0.18] px-4 font-body text-base font-semibold text-ink";
const ROWS = "divide-y divide-ink/[0.10] border-y border-ink/[0.10]";

// ─── Portable-text renderer for the sheet (no prose class, tight spacing) ─────

const bodyComponents: PortableTextComponents = {
  block: {
    normal: ({ children }) => (
      <p className="font-body text-[17px] leading-relaxed text-ink">{children}</p>
    ),
    // The section labels (Verso, Coro) are the song page's own eyebrow — the one
    // other uppercase the sheet allows besides its section titles.
    h1: ({ children }) => <p className={`${LYRIC_EYEBROW} mt-5 mb-1 first:mt-0`}>{children}</p>,
    h2: ({ children }) => <p className={`${LYRIC_EYEBROW} mt-5 mb-1 first:mt-0`}>{children}</p>,
    h3: ({ children }) => <p className={`${LYRIC_EYEBROW} mt-5 mb-1 first:mt-0`}>{children}</p>,
  },
  marks: {
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SongSheet() {
  const {
    sheet,
    sheetLoading,
    sheetError,
    sheetPlayKey,
    closeSheet,
    openSheet,
    playTrack,
    togglePlay,
    closePlayer,
    seek,
    getAudio,
    audioReady,
    player,
    queue,
    skip,
  } = usePlayer();
  const isOpen = !!(sheet || sheetLoading || sheetError);
  // No control in the meta row is a natural focus anchor (it's text and pills,
  // not buttons), so this points at the scrollable body root instead —
  // `tabIndex={-1}` makes it a valid, non-tab-stop restore/fallback target.
  const focusAnchorRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Which history week (if any) has its full setlist popover open.
  const [openSetIdx, setOpenSetIdx] = useState<number | null>(null);

  // Reset the setlist popover whenever a different song is loaded into the sheet.
  useEffect(() => { setOpenSetIdx(null); }, [sheet?._id]);

  useEffect(() => {
    if (!audioReady) return;
    const el = getAudio();
    if (!el) return;
    const onTime = () => {
      if (el.duration) {
        setProgress(el.currentTime / el.duration);
        setCurrentTime(el.currentTime);
        setDuration(el.duration);
      }
    };
    const onMeta = () => setDuration(el.duration || 0);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioReady, getAudio]);

  useEffect(() => {
    if (!player.track) {
      setProgress(0);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [player.track]);

  if (!isOpen) return null;

  // Same guard the song page uses: anything unparsable ("libre", "70-80") keeps
  // the static span rather than clicking a tempo nobody wrote down.
  const bpmNumber   = Number(sheet?.bpm);
  const bpm         = Number.isFinite(bpmNumber) && bpmNumber > 0 ? bpmNumber : null;
  const hasChords   = (sheet?.chords?.length ?? 0) > 0;
  const hasBody     = (sheet?.body?.length ?? 0) > 0;
  const hasAudio    = (sheet?.audioTracks?.filter(t => t.audioFileURL).length ?? 0) > 0;
  const hasPDFs     = (sheet?.chordsPDF?.length ?? 0) > 0;
  const hasHistory  = (sheet?.history?.length ?? 0) > 0;
  const hasContent  = hasChords || hasBody;
  const sheetTrack = sheet && player.track?.songSlug === sheet.slug ? player.track : null;
  // «Alaba (Praise)»: the Spanish name is CueDialog's title (the one heading, which
  // the sheet's tests pin); the ORIGINAL goes beside the artist, as on the song page.
  const { main, original } = splitSongTitle(sheet?.title);
  const activeSetEntry = openSetIdx !== null ? sheet?.history?.[openSetIdx] : undefined;

  return (
    <>
      <CueDialog
        open={isOpen}
        // The Spanish name alone, as the song page heads (ADR-0070): the catalogue
        // string would repeat the original a line above the «original · artista» line.
        title={sheet ? main || sheet.title : "Canción"}
        label={sheet?.title ? `Canción: ${sheet.title}` : "Detalle de canción"}
        mode="sheet"
        size="lg"
        fallbackFocusRef={focusAnchorRef}
        onDismiss={closeSheet}
      >

        {/* Under CueDialog's own title (the Spanish name): the original name and the artist, then the
            key / BPM / compás row — the song page's hero at sheet size. */}
        {sheet && (
          <div className="flex flex-col gap-4 px-5 pt-1">
            {(original || sheet.author) && (
              <p className="font-body text-[17px] leading-snug text-ink-muted">
                {original}
                {original && sheet.author && <span className="text-ink-dim"> · </span>}
                {sheet.author}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* The key the member will PLAY: opened from a setlist the chart below is
                  already transposed to `sheetPlayKey`, so the pill says that key and the
                  written one inside it as «orig.», the setlist row's own wording. Opened
                  from the library there is no service key and the written key stands. */}
              {(sheetPlayKey || sheet.key) && (
                <span className="inline-flex min-h-[48px] items-baseline gap-2.5 rounded-full border border-ink/[0.28] px-[18px]">
                  <span className="font-display text-2xl font-semibold leading-[46px] text-key-fg">{formatKey(sheetPlayKey || sheet.key)}</span>
                  {sheetPlayKey && sheet.key && sheetPlayKey !== sheet.key && (
                    <span className="font-body text-[13px] text-ink-dim">orig. {formatKey(sheet.key)}</span>
                  )}
                </span>
              )}
              {/* The sheet's tempo clicks too (F2, ruling 14) — the same pill as the
                  song hero, kept quiet by `enabled` when the sheet is dismissed. */}
              {bpm !== null ? (
                <TempoPill bpm={bpm} timeSig={sheet.timeSig ?? null} enabled={isOpen} />
              ) : sheet.bpm ? (
                <span className={RING}>{sheet.bpm} BPM</span>
              ) : null}
              {sheet.timeSig && <span className={RING}>{sheet.timeSig}</span>}
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div ref={focusAnchorRef} tabIndex={-1} className="flex-1 space-y-9 overflow-y-auto px-5 pb-6 pt-7">
          {sheetLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 rounded bg-accent-deep/20 animate-pulse" style={{ width: `${70 + (i % 3) * 10}%` }} />
              ))}
            </div>
          ) : sheet ? (
            <>
              {/* Lyrics / Chords — primary content */}
              {hasContent && (
                <div>
                  {hasChords ? (
                    <ChordChart charts={sheet.chords!} defaultKey={sheetPlayKey ?? undefined} />
                  ) : (
                    <div className="columns-1 sm:columns-2 gap-8">
                      {groupBySections(sheet.body!).map((group, i) => (
                        <div key={i} className="break-inside-avoid mb-4">
                          <PortableText value={group} components={bodyComponents} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(sheet?.rehearsalMixes?.length ?? 0) > 0 && (
                <div className="space-y-3">
                  <p className={SHEET_TITLE}>Ensayo</p>
                  <RehearsalPlayer
                    mixes={sheet!.rehearsalMixes!}
                    songId={sheet!._id}
                    songTitle={sheet!.title}
                    songSlug={sheet!.slug}
                    preselect={sheet!.myInstruments}
                  />
                </div>
              )}

              {/* Audio tracks — hairline rows with the song page's round control: the
                  LOADED track's button is the accent fill, every other one a ring. */}
              {hasAudio && (
                <div className="space-y-3">
                  <p className={SHEET_TITLE}>Audio</p>
                  <ul className={ROWS}>
                    {sheet.audioTracks!.filter(t => t.audioFileURL).map((track, i) => {
                      const audioTrack: AudioTrack = {
                        url: track.audioFileURL,
                        title: track.title,
                        tone: track.tone,
                        songTitle: sheet!.title,
                        songSlug: sheet!.slug,
                      };
                      const isCurrent = player.track?.url === track.audioFileURL;
                      const playing = isCurrent && player.isPlaying;
                      return (
                        <li key={i} className="flex min-h-[64px] items-center gap-3.5 py-2">
                          <Button
                            variant={isCurrent ? "roundCta" : "round"}
                            onClick={() => (isCurrent ? togglePlay() : playTrack(audioTrack))}
                            aria-label={`${playing ? "Pausar" : "Reproducir"} ${track.title}`}
                          >
                            <PlayPauseGlyph playing={playing} size={14} />
                          </Button>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-body text-[17px] font-semibold text-ink">{track.title}</span>
                            {track.tone && <span className="mt-0.5 block font-body text-sm text-ink-muted">{formatKey(track.tone) || track.tone}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {sheetTrack && (
                <div
                  className="sticky bottom-0 -mx-5 border-t border-ink/[0.10] bg-surface-base/95 backdrop-blur-md"
                  style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                  <AudioTransport
                    track={sheetTrack}
                    isPlaying={player.isPlaying}
                    currentTime={currentTime}
                    duration={duration}
                    progress={progress}
                    onToggle={togglePlay}
                    onSeek={seek}
                    onClose={() => closePlayer(focusAnchorRef.current)}
                    queue={queue ? { index: queue.index, total: queue.tracks.length } : null}
                    onSkip={skip}
                  />
                </div>
              )}

              {/* Chord PDFs — «Acordes», one hairline row per file. */}
              {hasPDFs && (
                <div className="space-y-3">
                  <p className={SHEET_TITLE}>Acordes</p>
                  <ul className={ROWS}>
                    {sheet.chordsPDF!.map((pdf, i) => (
                      <li key={i}>
                        <a
                          href={pdf.chordsURL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-[64px] items-center gap-3.5 py-2 text-ink transition-colors hover:text-accent"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-accent">
                            <PDFIcon />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-body text-[17px] font-semibold">{pdf.title}</span>
                            <span className="mt-0.5 block font-body text-sm text-ink-muted">PDF{pdf.key ? ` · tono ${formatKey(pdf.key)}` : ""}</span>
                          </span>
                          <ExternalLinkIcon size={18} className="shrink-0 text-ink-dim" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Historial — the last times played, the song page's rows: the day in
                  full, who led under it, the key played as a pill. A row with a stored
                  set opens the whole set. */}
              {hasHistory && (
                <div className="space-y-3">
                  <p className={SHEET_TITLE}>Últimas veces tocada</p>
                  <ul className={ROWS}>
                    {sheet.history!.map((entry, i) => {
                      const hasSet = (entry.setlist?.length ?? 0) > 0;
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => hasSet && setOpenSetIdx(i)}
                            disabled={!hasSet}
                            className={`flex w-full items-center gap-3.5 py-3.5 text-left transition-colors ${
                              hasSet ? "cursor-pointer hover:bg-accent/[0.055]" : "cursor-default"
                            }`}
                            title={hasSet ? "Ver el set completo" : undefined}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-body text-[17px] font-semibold leading-snug text-ink">
                                {entry._type === "featuredSongs" ? "Domingo" : "Sábado"} {formatHistoryDate(entry.week)}
                              </span>
                              <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm leading-snug text-ink-muted">
                                {entry.leaders && entry.leaders.length > 0 ? (
                                  <>
                                    <span>Lidera</span>
                                    {entry.leaders.map((lead, j) => (
                                      <span key={j} className="flex min-w-0 items-center gap-1.5">
                                        {lead.photo ? (
                                          <img src={lead.photo} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                                        ) : (
                                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-semibold text-ink">
                                            {(lead.name ?? "?").charAt(0).toUpperCase()}
                                          </span>
                                        )}
                                        <span className="truncate text-ink">{lead.name ?? "—"}</span>
                                      </span>
                                    ))}
                                  </>
                                ) : (
                                  <span className="italic text-ink-dim">Sin líder</span>
                                )}
                              </span>
                            </span>

                            {/* Key played — the second brand colour (ADR-0071). */}
                            <span className="shrink-0 rounded-full border border-ink/[0.18] px-2.5 py-1 font-label text-sm font-semibold text-key-fg">
                              {formatKey(entry.play_key || sheet!.key) || "—"}
                            </span>

                            {hasSet && <ChevronIcon />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Full page link — the last row of the sheet. */}
              <Link
                href={`/posts/${sheet.slug}`}
                onClick={closeSheet}
                className="flex min-h-[60px] items-center justify-between gap-3.5 border-y border-ink/[0.10] font-body text-[17px] font-semibold text-ink transition-colors hover:text-accent"
              >
                Ver la página completa
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink-dim">
                  <path d="M5 12h14" />
                  <path d="M13 6l6 6-6 6" />
                </svg>
              </Link>
            </>
          ) : sheetError ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mono-500">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="font-body text-sm text-mono-400">No se pudo cargar la canción.</p>
              <button
                onClick={closeSheet}
                className="font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg border border-surface-accent-l30-d25 text-mono-400 hover:text-accent hover:border-accent/40 dark:hover:border-surface-accent-l30-d25 transition-colors"
              >
                Cerrar
              </button>
            </div>
          ) : null}
        </div>
      </CueDialog>

      {/* Setlist popover — the whole set for a chosen history week */}
      <SetlistPopover
        open={!!activeSetEntry}
        entry={activeSetEntry}
        currentSongId={sheet?._id}
        fallbackFocusRef={focusAnchorRef}
        onClose={() => setOpenSetIdx(null)}
        onPick={(songId, playKey) => { setOpenSetIdx(null); openSheet(songId, playKey); }}
      />
    </>
  );
}

// ─── Setlist popover ──────────────────────────────────────────────────────────

function SetlistPopover({
  open,
  entry,
  currentSongId,
  fallbackFocusRef,
  onClose,
  onPick,
}: {
  open: boolean;
  entry?: SongHistoryEntry;
  currentSongId?: string;
  fallbackFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (songId: string, playKey?: string) => void;
}) {
  return (
    <CueDialog open={open} title="Set completo" label="Set completo" size="sm" fallbackFocusRef={fallbackFocusRef} onDismiss={onClose}>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-accent/10 bg-accent/[0.04]">
          <div>
            <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-0.5">
              {entry?._type === "featuredSongs" ? "Domingo" : "Sábado"} · Set completo
            </p>
            <p className="font-body text-sm font-semibold text-mono-200">
              {entry ? formatHistoryDate(entry.week) : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1 rounded-lg text-mono-500 hover:text-mono-300 hover:bg-surface-lift/5 transition-colors"
            aria-label="Cerrar"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Songs */}
        <ol className="max-h-[60vh] overflow-y-auto py-1.5">
          {entry?.setlist?.map((song, i) => {
            const isCurrent = song.id === currentSongId;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => !isCurrent && onPick(song.id, song.play_key)}
                  disabled={isCurrent}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isCurrent ? "bg-accent/[0.06] cursor-default" : "hover:bg-accent/[0.06]"
                  }`}
                >
                  <span className={`font-label text-[11px] w-4 shrink-0 ${isCurrent ? "text-accent" : "text-mono-600"}`}>
                    {i + 1}
                  </span>
                  <span className={`font-body text-sm flex-1 truncate ${isCurrent ? "text-accent font-semibold" : "text-mono-200"}`}>
                    {song.title ?? "—"}
                  </span>
                  {song.play_key && (
                    <span className="font-label text-xs px-2 py-0.5 rounded-full border border-accent/30 text-accent/80 shrink-0">
                      {formatKey(song.play_key)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </CueDialog>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-dim" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PDFIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
