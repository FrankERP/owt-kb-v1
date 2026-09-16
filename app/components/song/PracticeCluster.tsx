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
          <PlayIcon playing={playing} />
        </Button>
      )}
    </>
  );
}

// Task 5 swaps this for the morphing play/pause primitive; until then it is the
// same pair of glyphs `SongAudioSection` draws.
function PlayIcon({ playing }: { playing: boolean }) {
  if (playing) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
