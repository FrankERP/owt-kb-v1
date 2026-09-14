"use client";
// app/components/LibraryRow.tsx
// The library row (spec §12.2, §17, §19.2): key · title/artist · BPM · tags.
// A plain <button> in an <li> rather than the Button primitive — the recorded row
// exemption (the plan's rubric ruling): the row IS the affordance, like DayCard's
// setlist rows, so it carries no eyebrow and no "Ver". Memoised: ~140 rows share
// one player context.
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

  return (
    <button
      type="button"
      {...longPress}
      onClick={() => {
        // Native only, fire-and-forget (see haptics.ts) — never gates opening the sheet.
        void haptic("selection");
        openSheet(post._id);
      }}
      aria-label={`${post.title}${post.author ? `, ${post.author}` : ""}${post.key ? `, tonalidad ${post.key}` : ""}`}
      className="group flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-fast ease-out-brand hover:bg-accent/[0.055] active:bg-accent/[0.08] active:scale-[0.995] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="brand-key-dial shrink-0 font-display text-sm uppercase">{post.key || "—"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-base font-semibold text-ink transition-colors group-hover:text-accent">
          {post.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          {post.author && <span className="truncate font-body text-xs text-ink-dim">{post.author}</span>}
          {tags.length > 0 && (
            <span className="hidden min-w-0 items-center gap-1 sm:flex">
              {tags.slice(0, 3).map((t) => (
                <span key={t._id} className="rounded-full bg-accent/10 px-1.5 py-px font-label text-[10px] lowercase text-ink-dim">
                  #{t.name}
                </span>
              ))}
              {tags.length > 3 && <span className="font-label text-[10px] text-ink-dim">+{tags.length - 3}</span>}
            </span>
          )}
          {tags.length > 0 && (
            <span className="font-label text-[10px] text-ink-dim sm:hidden">
              #{tags[0].name}
              {tags.length > 1 ? ` +${tags.length - 1}` : ""}
            </span>
          )}
        </span>
      </span>
      {post.bpm && (
        <span className="shrink-0 font-label text-[11px] uppercase tracking-widest text-ink-dim tabular-nums">{post.bpm} BPM</span>
      )}
    </button>
  );
});
export default LibraryRow;
