"use client";

import { usePlayer, AudioTrack } from "@/app/context/PlayerContext";
import { DownloadIcon } from "./ui/icons";
import Button, { buttonClass } from "@/app/components/ui/Button";
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
    // Hairline rows, like the rehearsal mixes (ADR-0070): the playing row is the
    // one with a filled control and the equaliser; the download is an icon.
    <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
      {tracks.filter(t => t.audioFileURL).map((track, i) => {
        const audioTrack: AudioTrack = {
          url: track.audioFileURL,
          title: track.title,
          tone: track.tone,
          songTitle,
          songSlug,
        };
        const isCurrent = player.track?.url === track.audioFileURL;
        const playing = isCurrent && player.isPlaying;
        const trackName = `${track.title || "Audio"} ${i + 1}`;

        return (
          <li key={i} className="flex items-center gap-3 py-2.5">
            {isCurrent ? (
              <Button
                variant="cta"
                size="lg"
                className="h-11 w-11 shrink-0 rounded-full p-0"
                onClick={() => togglePlay()}
                aria-label={`${playing ? "Pausar" : "Reproducir"} ${trackName}`}
              >
                <PlayPauseGlyph playing={playing} size={14} />
              </Button>
            ) : (
              <Button
                variant="icon"
                size="lg"
                className="shrink-0 rounded-full border border-ink/[0.28] text-ink"
                onClick={() => playTrack(audioTrack)}
                aria-label={`Reproducir ${trackName}`}
              >
                <PlayPauseGlyph playing={false} size={14} />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-[17px] font-semibold leading-tight text-ink">{track.title}</p>
              {track.tone && <p className="font-body text-sm text-ink-muted">{track.tone}</p>}
            </div>
            <Equalizer playing={playing} />
            <a
              href={track.audioFileURL}
              download={`${songTitle} — ${track.title}.mp3`}
              aria-label={`Descargar ${trackName}`}
              title={`Descargar ${trackName}`}
              className={buttonClass("icon", "lg")}
            >
              <DownloadIcon size={16} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
