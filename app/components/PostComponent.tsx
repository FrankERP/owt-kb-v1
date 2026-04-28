"use client";

import Link from "next/link";
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

const PostComponent = ({ post }: Props) => {
  const { openSheet } = usePlayer();

  return (
    <div className={cardStyle} onClick={() => openSheet(post._id)}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-base lg:text-xl leading-snug mb-2 flex-1 min-w-0">
          {post?.title}
          {post?.author && (
            <span className="font-body font-normal text-gray-400 dark:text-gray-500">
              {" "}— {post.author}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {isNew(post._createdAt) && (
            <span className="font-label text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#00bfff]/15 text-[#00bfff] border border-[#00bfff]/30">
              Nuevo
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); openSheet(post._id); }}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors"
            title="Audio y acordes"
          >
            <MusicNoteIcon />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-label text-xs lg:text-base text-[#00bfff] mb-3">
        {post?.key    && <span>{post.key}</span>}
        {post?.bpm    && <><span className="text-gray-400">·</span><span>{post.bpm} BPM</span></>}
        {post?.timeSig && <><span className="text-gray-400">·</span><span>{post.timeSig}</span></>}
      </div>

      {post?.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <span
              key={tag._id}
              className="font-label text-xs lg:text-sm text-gray-400 dark:text-gray-500 lowercase"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default PostComponent;

const cardStyle = `
  block
  p-4 lg:p-6
  rounded-xl
  border border-[#003572]/25 dark:border-[#00bfff]/15
  hover:border-[#003572]/60 dark:hover:border-[#00bfff]/50
  hover:shadow-lg hover:shadow-[#00bfff]/10
  transition-all duration-200
  cursor-pointer
`;

function MusicNoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
