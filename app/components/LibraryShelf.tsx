"use client";
// app/components/LibraryShelf.tsx
// The Biblioteca's shelf (ADR-0088): the last songs that joined the catalogue as a row of
// album covers, above the A–Z list. It is the page's one PICTURE-first surface — the list
// under it is for finding a song whose name you know, the shelf is for noticing one you
// don't. Shown only while nothing filters: a search is somebody looking for one song, and a
// shelf of other songs above the results would be in the way.
//
// The row scrolls sideways inside its own box and bleeds to the screen's edges (`-mx-6 px-6`),
// so the half cover at the right edge says «there is more» without an arrow. Native overflow
// scrolling, not `SwipeStrip`: that one PAGES a strip that fits the width, this one is longer
// than the width on purpose.
//
// A card is a plain <button>, the row exemption `LibraryRow` records: the cover IS the
// affordance. It opens the same sheet a row does.
import { memo, useState } from "react";
import Image from "next/image";
import type { Post } from "@/app/utils/interface";
import { usePlayer } from "@/app/context/PlayerContext";
import { haptic } from "@/app/utils/haptics";
import { formatKey } from "@/app/utils/formatKey";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { songCoverUrl } from "@/app/utils/songCover";
import { splitSongTitle } from "@/app/utils/songTitle";
import { MusicNoteIcon } from "./ui/icons";

const ShelfCard = memo(function ShelfCard({ post, index }: { post: Post; index: number }) {
  const { openSheet } = usePlayer();
  const [failed, setFailed] = useState(false);
  const src = songCoverUrl(post.cover, "shelf");
  const { main } = splitSongTitle(post.title);
  // The legacy `author` line, as the row under it shows the artist: the two never disagree.
  const artist = post.author;
  return (
    <li className="w-[132px] shrink-0 snap-start animate-scale-in md:w-[156px]" style={{ animationDelay: `${index * 45}ms` }}>
      <button
        type="button"
        onClick={() => {
          void haptic("selection");
          openSheet(post._id);
        }}
        aria-label={`${post.title}${artist ? `, ${artist}` : ""}${post.key ? `, tonalidad ${formatKey(post.key)}` : ""}`}
        className="group block w-full rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
      >
        <span className="relative block aspect-square overflow-hidden rounded-2xl border border-ink/10 bg-gradient-to-br from-ink/[0.10] to-ink/[0.03] text-ink-dim shadow-[0_10px_24px_-14px_rgb(var(--elevation-rgb)/0.7)]">
          {src && !failed ? (
            // unoptimized: the JPEG `songCoverUrl` sized, never Next's WebP (the iOS WKWebView rule).
            <Image src={src} alt="" width={156} height={156} unoptimized loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-slow ease-out-brand group-hover:scale-[1.05]" />
          ) : (
            <span className="flex h-full w-full items-center justify-center"><MusicNoteIcon size={34} /></span>
          )}
          {/* The key rides on the cover's corner, in the key's own colour (ADR-0071), on a
              plate of the page's surface so it reads over any artwork. */}
          {post.key && (
            <span aria-hidden className="absolute bottom-1.5 right-1.5 flex h-8 min-w-8 items-center justify-center rounded-full border border-ink/[0.14] bg-surface-base/90 px-2 font-display text-[17px] font-semibold leading-none text-key-fg backdrop-blur-sm">
              {formatKey(post.key)}
            </span>
          )}
        </span>
        <span className="mt-2.5 block truncate font-body text-[15px] font-semibold leading-tight text-ink transition-colors group-hover:text-accent">{main}</span>
        {artist && <span className="mt-1 block truncate font-body text-[13px] leading-tight text-ink-muted">{artist}</span>}
      </button>
    </li>
  );
});

export default function LibraryShelf({ title, posts }: { title: string; posts: Post[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="biblioteca-estante" className="mb-2">
      <h2 id="biblioteca-estante" className={`${SHEET_TITLE} flex items-center gap-3 pb-3.5`}>
        {title}
        <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
      </h2>
      {/* `-mt-1 pt-1`: a scroll box clips on both axes, and a card's focus ring sits 4 px
          outside it — without the room its top edge is cut for a keyboard user. */}
      <ul className="scrollbar-hide -mx-6 -mt-1 flex snap-x snap-mandatory scroll-px-6 gap-3.5 overflow-x-auto px-6 pb-2 pt-1">
        {posts.map((p, i) => (
          <ShelfCard key={p._id} post={p} index={i} />
        ))}
      </ul>
    </section>
  );
}
