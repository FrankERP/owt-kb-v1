"use client";

import { AudioTrack } from "@/app/context/PlayerContext";

function fmtTime(s: number) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function AudioTransport({
  track,
  isPlaying,
  currentTime,
  duration,
  progress,
  onToggle,
  onSeek,
  onClose,
}: {
  track: AudioTrack;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 py-3">
      <button
        onClick={onToggle}
        className="w-11 h-11 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shrink-0 hover:bg-accent/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised-alt active:scale-95 transition-all"
        aria-label={isPlaying ? `Pausar ${track.songTitle} — ${track.title}` : `Reproducir ${track.songTitle} — ${track.title}`}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="truncate font-body text-xs font-semibold">{track.songTitle}</span>
          <span className="max-w-[8rem] shrink-0 truncate font-label text-[11px] uppercase tracking-widest text-mono-500">{track.title}</span>
          {track.tone && (
            <span className="shrink-0 font-label text-[11px] text-accent/60">{track.tone}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-right font-label text-[11px] tabular-nums text-mono-600">
            {fmtTime(currentTime)}
          </span>
          <div
            role="slider"
            tabIndex={0}
            aria-label={`Barra de progreso de ${track.songTitle} — ${track.title}`}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={fmtTime(currentTime)}
            className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-accent-deep/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised-alt"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - rect.left) / rect.width);
            }}
            onKeyDown={(e) => {
              if (!duration) return;
              let t: number | null = null;
              if (e.key === "ArrowRight") t = Math.min(duration, currentTime + 5);
              else if (e.key === "ArrowLeft") t = Math.max(0, currentTime - 5);
              else if (e.key === "Home") t = 0;
              else if (e.key === "End") t = duration;
              if (t !== null) {
                e.preventDefault();
                onSeek(t / duration);
              }
            }}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-100 group-hover:bg-accent/80"
              style={{ width: `${progress * 100}%` }}
            />
            <div className="absolute inset-y-0 -bottom-1 -top-1 left-0 right-0 opacity-0 group-hover:opacity-100" style={{ cursor: "pointer" }} />
          </div>
          <span className="w-8 shrink-0 font-label text-[11px] tabular-nums text-mono-600">
            {fmtTime(duration)}
          </span>
        </div>
      </div>

      <button
        onClick={onClose}
        className="-mr-1 shrink-0 rounded-lg p-2 text-mono-500 transition-colors hover:bg-surface-lift/5 hover:text-mono-300"
        aria-label={`Cerrar reproductor de ${track.songTitle} — ${track.title}`}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
