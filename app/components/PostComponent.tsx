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
      className="group relative flex flex-col gap-2.5 p-4 lg:p-5 rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 hover:border-[#003572]/50 dark:hover:border-[#00bfff]/40 hover:shadow-lg hover:shadow-[#00bfff]/10 cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60"
    >
      {/* New badge / hover eye — absolute, top-right */}
      <span className={`absolute top-4 right-4 pointer-events-none transition-opacity duration-150 ${fresh ? "group-hover:opacity-0" : "opacity-0 group-hover:opacity-100"}`}>
        {fresh ? (
          <span className="font-label text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#00bfff]/15 text-[#00bfff] border border-[#00bfff]/30">
            Nuevo
          </span>
        ) : (
          <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/60 flex items-center gap-1">
            <EyeIcon /> Ver
          </span>
        )}
      </span>
      {fresh && (
        <span className="absolute top-4 right-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-label text-[10px] uppercase tracking-widest text-[#00bfff]/60 flex items-center gap-1">
          <EyeIcon /> Ver
        </span>
      )}

      {/* Title */}
      <h2 className={`font-display text-base lg:text-lg font-bold leading-snug line-clamp-2 ${fresh ? "pr-14" : ""}`}>
        {post.title}
      </h2>

      {/* Author */}
      {post.author && (
        <p className="font-body text-sm text-gray-500 dark:text-gray-500 truncate -mt-1">
          {post.author}
        </p>
      )}

      {/* Key · BPM · TimeSig */}
      {(post.key || post.bpm || post.timeSig) && (
        <div className="flex items-center gap-2 flex-wrap">
          {post.key && (
            <span className="font-label text-xs px-2.5 py-0.5 rounded-full border border-[#00bfff]/40 text-[#00bfff]">
              {post.key}
            </span>
          )}
          {post.bpm && (
            <span className="font-label text-xs text-gray-500">{post.bpm} BPM</span>
          )}
          {post.bpm && post.timeSig && <span className="text-gray-700 text-xs">·</span>}
          {post.timeSig && (
            <span className="font-label text-xs text-gray-500">{post.timeSig}</span>
          )}
        </div>
      )}

      {/* Tags */}
      {post.tags?.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-1 border-t border-[#003572]/10 dark:border-[#00bfff]/10">
          {post.tags.map((tag) => (
            <span key={tag._id} className="font-label text-[10px] text-gray-500 dark:text-gray-400 lowercase">
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
