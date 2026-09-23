"use client";

import { usePlayer, AudioTrack } from "@/app/context/PlayerContext";
import Equalizer from "@/app/components/ui/Equalizer";
import PlayPauseGlyph from "@/app/components/ui/PlayPauseGlyph";

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
        const trackName = `${track.title || "Audio"} ${i + 1}`;

        return (
          <div
            key={i}
            className={`rounded-xl border p-5 space-y-4 transition-colors ${
              isCurrent
                ? "border-accent/50 bg-accent/5"
                : "border-surface-accent-l25-d15"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold leading-snug">{track.title}</p>
                {track.tone && (
                  <p className="font-label text-xs text-accent uppercase tracking-wide mt-1">{track.tone}</p>
                )}
              </div>
              <Equalizer playing={isCurrent && player.isPlaying} className="ml-auto" />
            </div>
            <button
              onClick={() => (isCurrent ? togglePlay() : playTrack(audioTrack))}
              aria-label={`${isCurrent && player.isPlaying ? "Pausar" : "Reproducir"} ${trackName}`}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                isCurrent
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-accent-deep/30 hover:border-accent/40 hover:bg-accent/5 text-mono-400 hover:text-accent"
              }`}
            >
              <PlayPauseGlyph playing={isCurrent && player.isPlaying} />
              {isCurrent && player.isPlaying ? "Reproduciendo" : "Reproducir"}
            </button>
            <a
              href={track.audioFileURL}
              download={`${songTitle} — ${track.title}.mp3`}
              aria-label={`Descargar ${trackName}`}
              className="block text-center font-label text-xs uppercase tracking-widest text-mono-500 dark:text-mono-400 hover:text-accent dark:hover:text-accent transition-colors"
            >
              Descargar ↓
            </a>
          </div>
        );
      })}
    </div>
  );
}
