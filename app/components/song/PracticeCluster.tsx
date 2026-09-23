"use client";

// What the hero was carrying, once the hero is gone (R4, ruling 1): the title,
// the SOUNDING key, the tempo and one play control. It rides the song page's own
// sticky section bar rather than the navbar, because the navbar centre is already
// spoken for — the song title on phones, the nav links at `lg`.
//
// The key comes from `useTransposeOptional()`, so it is the same seat the hero
// dial and `ChordChart` write: the bar can never show a key the chart disagrees
// with. Rendered outside a provider (nothing does today) it simply drops the key.

import { usePlayer, type AudioTrack } from "@/app/context/PlayerContext";
import Button from "@/app/components/ui/Button";
import NumberRoll from "@/app/components/ui/NumberRoll";
import PlayPauseGlyph from "@/app/components/ui/PlayPauseGlyph";
import { useTransposeOptional } from "./TransposeProvider";

export interface PracticeInfo {
  title: string;
  bpm: number | null;
  track: AudioTrack | null;
}

export default function PracticeCluster({ title, bpm, track }: PracticeInfo) {
  const { player, playTrack, togglePlay } = usePlayer();
  const soundingKey = useTransposeOptional()?.soundingKey ?? null;

  const isCurrent = !!track && player.track?.url === track.url;
  const playing = isCurrent && player.isPlaying;

  return (
    <>
      <span className="hidden lg:block max-w-[24ch] truncate font-display text-sm text-ink">{title}</span>

      {soundingKey && (
        <span className="brand-key-dial h-8 min-w-[2rem] px-2 font-display text-xs">
          <NumberRoll value={soundingKey} />
        </span>
      )}

      {bpm && (
        <span className="font-label text-[10px] uppercase tracking-widest text-ink-dim">{bpm} BPM</span>
      )}

      {track && (
        <Button
          variant="icon"
          size="lg"
          aria-label={`${playing ? "Pausar" : "Reproducir"} ${track.title}`}
          onClick={() => (isCurrent ? togglePlay() : playTrack(track))}
        >
          <PlayPauseGlyph playing={playing} />
        </Button>
      )}
    </>
  );
}
