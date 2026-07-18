"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PortableText } from "next-sanity";
import { usePlayer, AudioTrack, SongHistoryEntry } from "@/app/context/PlayerContext";
import AudioTransport from "./AudioTransport";
import ChordChart from "./ChordChart";
import CueDialog from "./ui/CueDialog";
import { groupBySections } from "@/app/utils/lyrics";

// ─── Portable-text renderer for the sheet (no prose class, tight spacing) ─────

const bodyComponents = {
  block: {
    normal: ({ children }: any) => (
      <p className="font-body text-sm leading-snug">{children}</p>
    ),
    h1: ({ children }: any) => (
      <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70 mt-4 mb-0.5 first:mt-0">
        {children}
      </p>
    ),
    h2: ({ children }: any) => (
      <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70 mt-4 mb-0.5 first:mt-0">
        {children}
      </p>
    ),
    h3: ({ children }: any) => (
      <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70 mt-4 mb-0.5 first:mt-0">
        {children}
      </p>
    ),
  },
  marks: {
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: any) => <em className="italic">{children}</em>,
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
  } = usePlayer();
  const isOpen = !!(sheet || sheetLoading || sheetError);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  const hasChords   = (sheet?.chords?.length ?? 0) > 0;
  const hasBody     = (sheet?.body?.length ?? 0) > 0;
  const hasAudio    = (sheet?.audioTracks?.filter(t => t.audioFileURL).length ?? 0) > 0;
  const hasPDFs     = (sheet?.chordsPDF?.length ?? 0) > 0;
  const hasHistory  = (sheet?.history?.length ?? 0) > 0;
  const hasContent  = hasChords || hasBody;
  const sheetTrack = sheet && player.track?.songSlug === sheet.slug ? player.track : null;

  return (
    <>
      <CueDialog
        open={isOpen}
        label={sheet?.title ? `Canción: ${sheet.title}` : "Detalle de canción"}
        mode="sheet"
        size="lg"
        fallbackFocusRef={closeButtonRef}
        onDismiss={closeSheet}
      >

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-brand-beam/10 bg-brand-deck/35 px-5 py-5">
          <div className="flex-1 min-w-0 pr-3">
            {sheetLoading ? (
              <div className="space-y-2">
                <div className="h-5 w-3/4 rounded bg-[#003572]/30 animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-[#003572]/20 animate-pulse" />
              </div>
            ) : sheet ? (
              <>
                <p className="mb-1 font-label text-[9px] uppercase tracking-[0.22em] text-brand-beam/70">Canción</p>
                <h2 className="font-display text-2xl leading-snug text-brand-frost">{sheet.title}</h2>
                {sheet.author && (
                  <p className="font-body text-sm text-gray-400 mt-0.5">{sheet.author}</p>
                )}
              </>
            ) : (
              <h2 className="font-display text-xl leading-snug">Canción</h2>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeSheet}
            className="p-2 -mr-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors shrink-0"
            aria-label="Cerrar"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {sheetLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 rounded bg-[#003572]/20 animate-pulse" style={{ width: `${70 + (i % 3) * 10}%` }} />
              ))}
            </div>
          ) : sheet ? (
            <>
              {/* Key / BPM / timeSig pills */}
              <div className="flex flex-wrap gap-2">
                {sheet.key && (
                  <span className="brand-key-dial px-3 font-display text-sm">
                    {sheet.key}
                  </span>
                )}
                {sheet.bpm && (
                  <span className="font-label text-sm px-3 py-1 rounded-full border border-[#C8D8EB]/15 text-[#C8D8EB]/50">
                    {sheet.bpm} BPM
                  </span>
                )}
                {sheet.timeSig && (
                  <span className="font-label text-sm px-3 py-1 rounded-full border border-[#C8D8EB]/15 text-[#C8D8EB]/50">
                    {sheet.timeSig}
                  </span>
                )}
              </div>

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

              {/* Audio tracks */}
              {hasAudio && (
                <div className="space-y-2 pt-1">
                  <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">Audio</p>
                  {sheet.audioTracks!.filter(t => t.audioFileURL).map((track, i) => {
                    const audioTrack: AudioTrack = {
                      url: track.audioFileURL,
                      title: track.title,
                      tone: track.tone,
                      songTitle: sheet!.title,
                      songSlug: sheet!.slug,
                    };
                    const isCurrent = player.track?.url === track.audioFileURL;
                    return (
                      <button
                        key={i}
                        onClick={() => (isCurrent ? togglePlay() : playTrack(audioTrack))}
                        aria-label={`${isCurrent && player.isPlaying ? "Pausar" : "Reproducir"} ${track.title}`}
                        className={`brand-library-module w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
                          isCurrent
                            ? "border-[#00bfff]/50 bg-[#00bfff]/10"
                            : "border-[#003572]/30 hover:border-[#00bfff]/30 hover:bg-[#00bfff]/5"
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          isCurrent ? "bg-[#00bfff] text-[#010b17]" : "bg-[#003572]/30 text-[#00bfff]"
                        }`}>
                          {isCurrent && player.isPlaying ? <PauseIcon /> : <PlayIcon />}
                        </span>
                        <div className="min-w-0">
                          <p className="font-body text-sm font-semibold truncate">{track.title}</p>
                          {track.tone && (
                            <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">{track.tone}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {sheetTrack && (
                <div
                  className="sticky bottom-0 -mx-5 border-t border-brand-beam/10 bg-brand-blackout/95 backdrop-blur-md"
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
                    onClose={() => closePlayer(closeButtonRef.current)}
                  />
                </div>
              )}

              {/* Chord PDFs */}
              {hasPDFs && (
                <div className="space-y-2 pt-1">
                  <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">PDFs</p>
                  {sheet.chordsPDF!.map((pdf, i) => (
                    <a
                      key={i}
                      href={pdf.chordsURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="brand-library-module brand-surface-interactive flex items-center gap-3 px-4 py-3"
                    >
                      <span className="w-7 h-7 rounded-full bg-[#003572]/30 text-[#00bfff] flex items-center justify-center shrink-0">
                        <PDFIcon />
                      </span>
                      <span className="font-body text-sm flex-1">
                        {pdf.title}{pdf.key ? ` — ${pdf.key}` : ""}
                      </span>
                      <span className="font-label text-[10px] text-gray-500 shrink-0">↗</span>
                    </a>
                  ))}
                </div>
              )}

              {/* Historial — last 5 times played: key + who led */}
              {hasHistory && (
                <div className="space-y-2 pt-1">
                  <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">
                    Últimas veces tocada
                  </p>
                  <ul className="space-y-2">
                    {sheet.history!.map((entry, i) => {
                      const hasSet = (entry.setlist?.length ?? 0) > 0;
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => hasSet && setOpenSetIdx(i)}
                            disabled={!hasSet}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[#003572]/30 bg-[#00bfff]/[0.03] text-left transition-colors ${
                              hasSet ? "hover:border-[#00bfff]/40 hover:bg-[#00bfff]/[0.07] cursor-pointer" : "cursor-default"
                            }`}
                            title={hasSet ? "Ver el set completo" : undefined}
                          >
                            {/* Date + service */}
                            <div className="min-w-0 shrink-0">
                              <p className="font-label text-[9px] uppercase tracking-widest text-gray-500 leading-none mb-1">
                                {entry._type === "featuredSongs" ? "Domingo" : "Sábado"}
                              </p>
                              <p className="font-body text-xs text-gray-300 leading-none whitespace-nowrap">
                                {formatHistoryDate(entry.week)}
                              </p>
                            </div>

                            {/* Leaders */}
                            <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 flex-wrap">
                              {entry.leaders && entry.leaders.length > 0 ? (
                                entry.leaders.map((lead, j) => (
                                  <span key={j} className="flex items-center gap-1.5 min-w-0">
                                    {lead.photo ? (
                                      <img
                                        src={lead.photo}
                                        alt=""
                                        className="w-5 h-5 rounded-full object-cover border border-[#00bfff]/25 shrink-0"
                                      />
                                    ) : (
                                      <span className="w-5 h-5 rounded-full bg-[#003572]/50 text-[#00bfff] flex items-center justify-center text-[9px] font-semibold shrink-0">
                                        {(lead.name ?? "?").charAt(0).toUpperCase()}
                                      </span>
                                    )}
                                    <span className="font-body text-xs text-gray-300 truncate">
                                      {lead.name ?? "—"}
                                    </span>
                                  </span>
                                ))
                              ) : (
                                <span className="font-body text-xs text-gray-600 italic">
                                  Sin líder
                                </span>
                              )}
                            </div>

                            {/* Key played */}
                            <span className="font-label text-xs px-2.5 py-1 rounded-full border border-[#00bfff]/40 text-[#00bfff] shrink-0">
                              {entry.play_key || sheet!.key || "—"}
                            </span>

                            {/* Affordance */}
                            {hasSet && <ChevronIcon />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Full page link */}
              <Link
                href={`/posts/${sheet.slug}`}
                onClick={closeSheet}
                className="brand-search-console flex w-full items-center justify-center gap-2 py-3 font-label text-xs uppercase tracking-widest text-brand-steel/70 transition-colors hover:border-brand-beam/35 hover:text-brand-beam"
              >
                Ver página completa ↗
              </Link>
            </>
          ) : sheetError ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="font-body text-sm text-gray-400">No se pudo cargar la canción.</p>
              <button
                onClick={closeSheet}
                className="font-label text-xs uppercase tracking-widest px-4 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/25 text-gray-400 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors"
              >
                Cerrar
              </button>
            </div>
          ) : null}
        </div>
      </CueDialog>

      {/* Setlist popover — the whole set for a chosen history week */}
      {openSetIdx !== null && sheet?.history?.[openSetIdx] && (
        <SetlistPopover
          entry={sheet.history[openSetIdx]}
          currentSongId={sheet._id}
          fallbackFocusRef={closeButtonRef}
          onClose={() => setOpenSetIdx(null)}
          onPick={(songId, playKey) => { setOpenSetIdx(null); openSheet(songId, playKey); }}
        />
      )}
    </>
  );
}

// ─── Setlist popover ──────────────────────────────────────────────────────────

function SetlistPopover({
  entry,
  currentSongId,
  fallbackFocusRef,
  onClose,
  onPick,
}: {
  entry: SongHistoryEntry;
  currentSongId: string;
  fallbackFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPick: (songId: string, playKey?: string) => void;
}) {
  return (
    <CueDialog open title="Set completo" label="Set completo" size="sm" fallbackFocusRef={fallbackFocusRef} onDismiss={onClose}>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#00bfff]/10 bg-[#00bfff]/[0.04]">
          <div>
            <p className="font-label text-[9px] uppercase tracking-widest text-gray-500 mb-0.5">
              {entry._type === "featuredSongs" ? "Domingo" : "Sábado"} · Set completo
            </p>
            <p className="font-body text-sm font-semibold text-gray-200">
              {formatHistoryDate(entry.week)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
            aria-label="Cerrar"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Songs */}
        <ol className="max-h-[60vh] overflow-y-auto py-1.5">
          {entry.setlist!.map((song, i) => {
            const isCurrent = song.id === currentSongId;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => !isCurrent && onPick(song.id, song.play_key)}
                  disabled={isCurrent}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isCurrent ? "bg-[#00bfff]/[0.06] cursor-default" : "hover:bg-[#00bfff]/[0.06]"
                  }`}
                >
                  <span className={`font-label text-[10px] w-4 shrink-0 ${isCurrent ? "text-[#00bfff]" : "text-gray-600"}`}>
                    {i + 1}
                  </span>
                  <span className={`font-body text-sm flex-1 truncate ${isCurrent ? "text-[#00bfff] font-semibold" : "text-gray-200"}`}>
                    {song.title ?? "—"}
                  </span>
                  {song.play_key && (
                    <span className="font-label text-[11px] px-2 py-0.5 rounded-full border border-[#00bfff]/30 text-[#00bfff]/80 shrink-0">
                      {song.play_key}
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

function formatHistoryDate(week: string) {
  // Dates are stored as `date` (YYYY-MM-DD); pin to local noon to avoid UTC day-flip.
  return new Date(week.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 shrink-0">
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
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
