"use client";

import React from "react";
import { Post } from "../utils/interface";
import { usePlayer } from "@/app/context/PlayerContext";

interface Props {
  post: Post;
}

const NEW_DAYS = 30;

function isNew(createdAt?: string) {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() < NEW_DAYS * 86400_000;
}

// Memoized: the song grid renders ~140 of these. With a stable player-context
// value (see PlayerContext useMemo), memoizing here means a card only re-renders
// when its own `post` prop changes, not on every player interaction.
const PostComponent = React.memo(({ post }: Props) => {
  const { openSheet } = usePlayer();
  const fresh = isNew(post._createdAt);

  return (
    <div
      onClick={() => openSheet(post._id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSheet(post._id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Ver ${post.title}`}
      className="brand-library-module brand-surface-interactive group relative flex cursor-pointer flex-col gap-4 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-beam/60 lg:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="brand-key-dial shrink-0 font-display text-sm uppercase">
          {post.key || "—"}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 font-label text-[9px] uppercase tracking-[0.2em] text-brand-steel/55">
            Repertorio
          </p>
          <h2 className="line-clamp-2 font-display text-base font-semibold leading-snug text-brand-frost transition-colors group-hover:text-brand-beam lg:text-lg">
            {post.title}
          </h2>
          {post.author && (
            <p className="mt-1 truncate font-body text-sm text-brand-steel/70">
              {post.author}
            </p>
          )}
        </div>
        <span className={`pointer-events-none mt-1 flex shrink-0 items-center gap-1 font-label text-[9px] uppercase tracking-widest transition-colors ${fresh ? "text-brand-beam" : "text-brand-steel/40 group-hover:text-brand-beam/80"}`}>
          {fresh ? "Nuevo" : <><EyeIcon /> Ver</>}
        </span>
      </div>

      {(post.bpm || post.timeSig) && (
        <div className="flex items-center gap-3 border-t border-brand-steel/10 pt-3 font-label text-[10px] uppercase tracking-widest text-brand-steel/55">
          {post.bpm && <span>{post.bpm} BPM</span>}
          {post.bpm && post.timeSig && <span className="h-3 w-px bg-brand-steel/15" />}
          {post.timeSig && <span>{post.timeSig}</span>}
        </div>
      )}

      {/* Tags */}
      {post.tags?.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${post.bpm || post.timeSig ? "" : "border-t border-brand-steel/10 pt-3"}`}>
          {post.tags.map((tag) => (
            <span key={tag._id} className="rounded-md border border-brand-steel/10 bg-brand-blackout/30 px-2 py-1 font-label text-[9px] lowercase text-brand-steel/60 transition-colors group-hover:border-brand-beam/15 group-hover:text-brand-steel/85">
              #{tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
PostComponent.displayName = "PostComponent";

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default PostComponent;
