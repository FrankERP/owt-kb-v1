import Link from "next/link";
import React from "react";
import { Post } from "../utils/interface";

interface Props {
  post: Post;
}

const PostComponent = ({ post }: Props) => {
  return (
    <Link href={`/posts/${post?.slug?.current}`} className={cardStyle}>
      <h2 className="font-display text-base leading-snug mb-2">
        {post?.title}
        {post?.author && (
          <span className="font-body font-normal text-gray-400 dark:text-gray-500">
            {" "}— {post.author}
          </span>
        )}
      </h2>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-label text-xs text-[#00bfff] mb-3">
        {post?.key    && <span>{post.key}</span>}
        {post?.bpm    && <><span className="text-gray-400">·</span><span>{post.bpm} BPM</span></>}
        {post?.timeSig && <><span className="text-gray-400">·</span><span>{post.timeSig}</span></>}
      </div>

      {post?.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <span
              key={tag._id}
              className="font-label text-xs text-gray-400 dark:text-gray-500 lowercase"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
};

export default PostComponent;

const cardStyle = `
  block
  p-4
  rounded-xl
  border border-[#003572]/25 dark:border-[#00bfff]/15
  hover:border-[#003572]/60 dark:hover:border-[#00bfff]/50
  hover:shadow-lg hover:shadow-[#00bfff]/10
  transition-all duration-200
  cursor-pointer
`;
