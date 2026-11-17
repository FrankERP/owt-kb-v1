"use client";

// The song page's own picture (ADR-0088): the album's cover beside the title — the same
// image the song wears on a service card and in the Biblioteca, here at the size of a record
// sleeve. It is what makes a song's page look like THAT song before a word is read.
//
// A client component for one reason: while one of this song's tracks plays (a rehearsal mix,
// an audio track), the cover carries the app's equalizer — the page shows it is the thing
// making the sound. `Equalizer` is the one ambient animation in the app and stops with the
// audio; nothing else here moves after the entry.
//
// Decoration (`alt=""`): the heading beside it names the song.

import Image from "next/image";
import { useState } from "react";
import { usePlayer } from "@/app/context/PlayerContext";
import Equalizer from "../ui/Equalizer";

export default function SongHeroCover({ src, songSlug }: { /** `songCoverUrl(cover, "hero")`. */ src: string; songSlug: string }) {
  const { player } = usePlayer();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const playing = player.isPlaying && player.track?.songSlug === songSlug;
  return (
    <span aria-hidden className="relative block h-[124px] w-[124px] shrink-0 animate-scale-in md:h-[208px] md:w-[208px]">
      <span className="block h-full w-full overflow-hidden rounded-2xl border border-ink/[0.14] shadow-[0_22px_44px_-18px_rgb(var(--elevation-rgb)/0.75)] md:rounded-3xl">
        {/* unoptimized: the JPEG `songCoverUrl` sized, never Next's WebP (the iOS WKWebView rule). */}
        <Image src={src} alt="" width={208} height={208} unoptimized priority onError={() => setFailed(true)} className="h-full w-full object-cover" />
      </span>
      {playing && (
        <span className="absolute bottom-2 left-2 flex h-7 items-center rounded-full border border-ink/[0.14] bg-surface-base/90 px-2.5 backdrop-blur-sm animate-fade-in">
          <Equalizer playing />
        </span>
      )}
    </span>
  );
}
