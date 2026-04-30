"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PortableText } from "next-sanity";
import { usePlayer, AudioTrack } from "@/app/context/PlayerContext";
import ChordChart from "./ChordChart";
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
  const { sheet, sheetLoading, closeSheet, playTrack, player } = usePlayer();
  const isOpen = !!(sheet || sheetLoading);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSheet(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeSheet]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;

  const hasChords   = (sheet?.chords?.length ?? 0) > 0;
  const hasBody     = (sheet?.body?.length ?? 0) > 0;
  const hasAudio    = (sheet?.audioTracks?.filter(t => t.audioFileURL).length ?? 0) > 0;
  const hasPDFs     = (sheet?.chordsPDF?.length ?? 0) > 0;
  const hasContent  = hasChords || hasBody;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm" onClick={closeSheet} />

      {/* Sheet — bottom drawer on mobile, centered modal on lg+ */}
      <div className="fixed inset-x-0 bottom-0 z-[60] max-h-[92svh] rounded-t-2xl bg-[#0a1929] border-t border-[#00bfff]/20 flex flex-col overflow-hidden lg:inset-auto lg:left-1/2 lg:-translate-x-1/2 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:rounded-2xl lg:border lg:border-[#00bfff]/20 lg:shadow-2xl">

        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#00bfff]/20" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#00bfff]/10 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            {sheetLoading ? (
              <div className="space-y-2">
                <div className="h-5 w-3/4 rounded bg-[#003572]/30 animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-[#003572]/20 animate-pulse" />
              </div>
            ) : (
              <>
                <h2 className="font-display text-xl leading-snug">{sheet!.title}</h2>
                {sheet!.author && (
                  <p className="font-body text-sm text-gray-400 mt-0.5">{sheet!.author}</p>
                )}
              </>
            )}
          </div>
          <button
            onClick={closeSheet}
            className="text-gray-500 hover:text-gray-300 transition-colors text-2xl leading-none shrink-0 mt-0.5"
          >
            ×
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
                  <span className="font-label text-sm px-3 py-1 rounded-full border border-[#00bfff]/40 text-[#00bfff]">
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
                    <ChordChart charts={sheet.chords!} />
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
                        onClick={() => playTrack(audioTrack)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left ${
                          isCurrent
                            ? "border-[#00bfff]/50 bg-[#00bfff]/10"
                            : "border-[#003572]/30 hover:border-[#00bfff]/30 hover:bg-[#00bfff]/5"
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          isCurrent ? "bg-[#00bfff] text-[#010b17]" : "bg-[#003572]/30 text-[#00bfff]"
                        }`}>
                          <PlayIcon />
                        </span>
                        <div className="min-w-0">
                          <p className="font-body text-sm font-semibold truncate">{track.title}</p>
                          {track.tone && (
                            <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">{track.tone}</p>
                          )}
                        </div>
                        {isCurrent && player.isPlaying && (
                          <span className="ml-auto text-[#00bfff] text-xs">▶</span>
                        )}
                      </button>
                    );
                  })}
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
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#003572]/30 hover:border-[#00bfff]/30 hover:bg-[#00bfff]/5 transition-colors"
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

              {/* Full page link */}
              <Link
                href={`/posts/${sheet.slug}`}
                onClick={closeSheet}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-[#003572]/25 hover:border-[#00bfff]/30 font-label text-xs uppercase tracking-widest text-gray-400 hover:text-[#00bfff] transition-colors"
              >
                Ver página completa ↗
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
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
