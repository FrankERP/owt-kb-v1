"use client";

// A song's picture on a setlist row (ADR-0087): the cover of its album, cropped square, or a
// neutral tile with a note when the song has none (or the image fails to load). It is what turns
// a setlist from five lines of text into five things: the eye finds «Nadie» by its cover the
// second time it looks.
//
// `n` is the song's place in the set, on the tile's corner — where the run sheet's number column
// used to be. The picture is decoration (`alt=""`): the row's own words name the song.

import Image from "next/image";
import { useState } from "react";
import { MusicNoteIcon } from "../ui/icons";

const SIZE = {
  xs: { box: "h-7 w-7 rounded-md", px: 28, icon: 12 },
  sm: { box: "h-10 w-10 rounded-lg", px: 40, icon: 15 },
  md: { box: "h-[52px] w-[52px] rounded-[10px]", px: 52, icon: 18 },
} as const;

export default function SongCover({
  src,
  n,
  size = "md",
  className = "",
}: {
  /** `songCoverUrl`'s result; absent or null draws the neutral tile. */
  src?: string | null;
  n?: number;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const s = SIZE[size];
  return (
    <span aria-hidden className={`relative inline-flex shrink-0 ${className}`}>
      <span className={`flex ${s.box} items-center justify-center overflow-hidden border border-ink/10 bg-gradient-to-br from-ink/[0.10] to-ink/[0.03] text-ink-dim`}>
        {src && !failed ? (
          // unoptimized: the image as Sanity serves it (`songCoverUrl` sizes it), never
          // Next's WebP (the iOS WKWebView rule the avatars follow).
          <Image src={src} alt="" width={s.px} height={s.px} unoptimized loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-slow ease-out-brand group-hover:scale-[1.06]" />
        ) : (
          <MusicNoteIcon size={s.icon} />
        )}
      </span>
      {n !== undefined && (
        <span className="absolute -left-1.5 -top-1.5 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border border-ink/[0.14] bg-surface-base px-1 font-label text-[10px] leading-none tabular-nums text-ink-muted">
          {n}
        </span>
      )}
    </span>
  );
}

/**
 * A set's pictures in a row — «this service has its songs» on a folded card, and which ones
 * for anyone who knows the covers. Side by side, never overlapped: three busy covers on top of
 * each other read as one smudge. Past `max`, the count beside the row says the rest.
 */
export function CoverRow({ covers, max = 5 }: { covers: Array<string | null>; max?: number }) {
  const shown = covers.slice(0, max);
  if (shown.length === 0) return null;
  return (
    <span aria-hidden className="flex gap-1">
      {shown.map((src, i) => (
        <span key={i} className="animate-scale-in" style={{ animationDelay: `calc(var(--reveal-i, 0) * 40ms + ${200 + i * 45}ms)` }}>
          <SongCover src={src} size="xs" />
        </span>
      ))}
    </span>
  );
}
