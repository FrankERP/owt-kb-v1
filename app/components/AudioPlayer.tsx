"use client";

import { usePlayer } from "@/app/context/PlayerContext";

export default function AudioPlayer() {
  const { player, togglePlay, closePlayer, seek } = usePlayer();

  if (!player.track) return null;

  const { track, isPlaying, progress } = player;

  return (
    <div className="fixed bottom-16 lg:bottom-0 inset-x-0 z-40 bg-[#0a1929]/95 backdrop-blur-md border-t border-[#00bfff]/20 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-[#00bfff]/15 border border-[#00bfff]/40 flex items-center justify-center text-[#00bfff] shrink-0 hover:bg-[#00bfff]/25 transition-colors"
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Info + seek bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="font-body text-xs font-semibold truncate">{track.songTitle}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500 shrink-0">{track.title}</span>
            {track.tone && (
              <span className="font-label text-[10px] text-[#00bfff]/60 shrink-0">{track.tone}</span>
            )}
          </div>
          <div
            role="progressbar"
            className="w-full h-1 bg-[#003572]/60 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-1 bg-[#00bfff] rounded-full transition-all duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        {/* Close */}
        <button
          onClick={closePlayer}
          className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 text-xl leading-none"
          aria-label="Cerrar reproductor"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
