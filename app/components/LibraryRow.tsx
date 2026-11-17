"use client";
// app/components/LibraryRow.tsx
// The library row (spec §12.2, §17, §19.2; ADR-0070's Biblioteca pass, ADR-0088's covers):
// the album's cover, the title at 17 px over «original · artista», and the key in the
// display face over the BPM on the right. A plain <button> in an <li> rather than the
// Button primitive — the recorded row exemption (the plan's rubric ruling): the row IS the
// affordance, like DayCard's setlist rows, so it carries no eyebrow and no "Ver".
// Memoised: ~140 rows share one player context.
//
// The cover leads the row (ADR-0088): 148 lines of text were found by reading, a cover is
// found by looking — the same picture the song wears on a service card. The key moved to
// the right edge to make room, and stays what it was: the SECOND brand colour
// (`text-key-fg`, ADR-0071), in one column down the page so a musician still scans by key.
// The first theme shows from `md` only — on a phone the cover took its width, and the
// themes live in the sheet and the filter drawer.
//
// A long press (R7 Task 4, spec §12.8) reports the row through `onQuickActions`
// instead of opening the song sheet; the tap is unchanged and the press swallows
// its own click. The SHEET itself lives once on `LibraryIndex`, not per row: a
// mounted `QuickActions` subscribes to the CueDialog layer context, so ~140 closed
// sheets would re-render every row each time any dialog anywhere opened or closed.
import { memo } from "react";
import type { Post } from "@/app/utils/interface";
import { usePlayer } from "@/app/context/PlayerContext";
import { haptic } from "@/app/utils/haptics";
import useLongPress from "./ui/useLongPress";
import { formatKey } from "@/app/utils/formatKey";
import { splitSongTitle } from "@/app/utils/songTitle";
import { songCoverUrl } from "@/app/utils/songCover";
import SongCover from "./service/SongCover";

const LibraryRow = memo(function LibraryRow({
  post,
  onQuickActions,
}: {
  post: Post;
  // Must be stable (the caller's `useCallback`) or the memo above buys nothing.
  onQuickActions?: (post: Post) => void;
}) {
  const { openSheet } = usePlayer();
  const longPress = useLongPress(() => onQuickActions?.(post));
  const tags = post.tags ?? [];
  // «Alaba (Praise)» → the Spanish name as the title, the original beside the
  // artist — the song page's own split (ADR-0070), so the two never disagree.
  const { main, original } = splitSongTitle(post.title);
  const sub = [original, post.author].filter(Boolean);

  return (
    <button
      type="button"
      {...longPress}
      onClick={() => {
        // Native only, fire-and-forget (see haptics.ts) — never gates opening the sheet.
        void haptic("selection");
        openSheet(post._id);
      }}
      aria-label={`${post.title}${post.author ? `, ${post.author}` : ""}${post.key ? `, tonalidad ${formatKey(post.key)}` : ""}`}
      className="group flex min-h-[72px] w-full items-center gap-3.5 px-2 py-2.5 text-left transition-colors duration-fast ease-out-brand hover:bg-accent/[0.055] active:bg-accent/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      <SongCover src={songCoverUrl(post.cover)} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-[17px] font-semibold leading-tight text-ink transition-colors group-hover:text-accent">
          {main}
        </span>
        {sub.length > 0 && (
          <span className="mt-1 block truncate font-body text-sm leading-tight text-ink-muted">
            {sub.map((part, i) => (
              <span key={i}>
                {i > 0 && <span className="text-ink-dim"> · </span>}
                {part}
              </span>
            ))}
          </span>
        )}
      </span>
      {/* The first theme only, as the song page sets its tags (quiet lowercase, the tag
          blue), and only where there is room for it. */}
      {tags.length > 0 && (
        <span className="hidden shrink-0 font-label text-xs font-semibold lowercase text-accent/70 md:block">#{tags[0].name}</span>
      )}
      {/* No `uppercase`: it turned «Bb» into «BB», a different note. `formatKey` spells the
          accidental as a symbol instead («B♭»), the one spelling every surface uses. */}
      <span className="flex w-[54px] shrink-0 flex-col items-center gap-1.5">
        <span className={`font-display text-[23px] font-semibold leading-none ${post.key ? "text-key-fg" : "text-ink-dim"}`}>
          {formatKey(post.key) || "—"}
        </span>
        {post.bpm && <span className="whitespace-nowrap font-body text-[11px] leading-none text-ink-dim tabular-nums">{post.bpm} BPM</span>}
      </span>
    </button>
  );
});
export default LibraryRow;
