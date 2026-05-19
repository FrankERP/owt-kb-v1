"use client";

import { useState, useEffect } from "react";
import { usePlayer } from "@/app/context/PlayerContext";

function fmtTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function AudioPlayer() {
  const { player, togglePlay, closePlayer, seek, getAudio } = usePlayer();
  const [progress, setProgress]     = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(0);

  useEffect(() => {
    const el = getAudio();
    if (!el) return;
    const onTime = () => {
      if (el.duration) {
        const pct = el.currentTime / el.duration;
        setProgress(pct);
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
  }, [getAudio]);

  useEffect(() => {
    if (!player.track) { setProgress(0); setCurrentTime(0); setDuration(0); }
  }, [player.track]);

  if (!player.track) return null;

  const { track, isPlaying } = player;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-[#0a1929]/95 backdrop-blur-md border-t border-[#00bfff]/20 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className="w-11 h-11 rounded-full bg-[#00bfff]/15 border border-[#00bfff]/40 flex items-center justify-center text-[#00bfff] shrink-0 hover:bg-[#00bfff]/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1929] active:scale-95 transition-all"
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Info + seek bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-body text-xs font-semibold truncate">{track.songTitle}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500 shrink-0 truncate max-w-[8rem]">{track.title}</span>
            {track.tone && (
              <span className="font-label text-[10px] text-[#00bfff]/60 shrink-0">{track.tone}</span>
            )}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <span className="font-label text-[10px] text-gray-600 tabular-nums shrink-0 w-8 text-right">
              {fmtTime(currentTime)}
            </span>
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              className="flex-1 h-1.5 bg-[#003572]/60 rounded-full cursor-pointer group relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - rect.left) / rect.width);
              }}
            >
              <div
                className="h-full bg-[#00bfff] rounded-full transition-[width] duration-100 group-hover:bg-[#00bfff]/80"
                style={{ width: `${progress * 100}%` }}
              />
              <div
                className="absolute inset-y-0 -top-1 -bottom-1 left-0 right-0 opacity-0 group-hover:opacity-100"
                style={{ cursor: "pointer" }}
              />
            </div>
            <span className="font-label text-[10px] text-gray-600 tabular-nums shrink-0 w-8">
              {fmtTime(duration)}
            </span>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={closePlayer}
          className="p-2 -mr-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors shrink-0"
          aria-label="Cerrar reproductor"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
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
