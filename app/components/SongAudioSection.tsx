"use client";

import { usePlayer, AudioTrack } from "@/app/context/PlayerContext";

interface Track {
  title: string;
  tone?: string;
  audioFileURL: string;
}

interface Props {
  tracks: Track[];
  songTitle: string;
  songSlug: string;
}

export default function SongAudioSection({ tracks, songTitle, songSlug }: Props) {
  const { playTrack, togglePlay, player } = usePlayer();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {tracks.filter(t => t.audioFileURL).map((track, i) => {
        const audioTrack: AudioTrack = {
          url: track.audioFileURL,
          title: track.title,
          tone: track.tone,
          songTitle,
          songSlug,
        };
        const isCurrent = player.track?.url === track.audioFileURL;

        return (
          <div
            key={i}
            className={`rounded-xl border p-5 space-y-4 transition-colors ${
              isCurrent
                ? "border-[#00bfff]/50 bg-[#00bfff]/5"
                : "border-[#003572]/25 dark:border-[#00bfff]/15"
            }`}
          >
            <div>
              <p className="font-display text-base font-semibold leading-snug">{track.title}</p>
              {track.tone && (
                <p className="font-label text-xs text-[#00bfff] uppercase tracking-wide mt-1">{track.tone}</p>
              )}
            </div>
            <button
              onClick={() => (isCurrent ? togglePlay() : playTrack(audioTrack))}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                isCurrent
                  ? "border-[#00bfff]/50 bg-[#00bfff]/15 text-[#00bfff]"
                  : "border-[#003572]/30 hover:border-[#00bfff]/40 hover:bg-[#00bfff]/5 text-gray-400 hover:text-[#00bfff]"
              }`}
            >
              <PlayIcon playing={isCurrent && player.isPlaying} />
              {isCurrent && player.isPlaying ? "Reproduciendo" : "Reproducir"}
            </button>
            <a
              href={track.audioFileURL}
              download={`${songTitle} — ${track.title}.mp3`}
              className="block text-center font-label text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-[#00bfff] dark:hover:text-[#00bfff] transition-colors"
            >
              Descargar ↓
            </a>
          </div>
        );
      })}
    </div>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
