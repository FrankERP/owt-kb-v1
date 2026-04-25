"use client";

import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import { Post } from "../utils/interface";
import PostComponent from "./PostComponent";

interface Props {
  posts: Post[];
}

const fuseOptions = {
  keys: [
    { name: "title", weight: 3 },
    { name: "author", weight: 1 },
  ],
  threshold: 0.35,
  distance: 200,
  minMatchCharLength: 2,
  shouldSort: true,
  includeScore: true,
};

export default function SongSearchList({ posts }: Props) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(() => new Fuse(posts, fuseOptions), [posts]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return posts;

    const ql = q.toLowerCase();

    if (q.length <= 2) {
      // Exact substring match, prefix-first
      return posts
        .filter(
          (p) =>
            p.title?.toLowerCase().includes(ql) ||
            p.author?.toLowerCase().includes(ql)
        )
        .sort((a, b) => {
          const aTitle = a.title?.toLowerCase() ?? "";
          const bTitle = b.title?.toLowerCase() ?? "";
          const aStarts = aTitle.startsWith(ql);
          const bStarts = bTitle.startsWith(ql);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return aTitle.localeCompare(bTitle);
        });
    }

    // Fuzzy search for 3+ characters
    return fuse
      .search(q)
      .sort((a, b) => {
        const aTitle = a.item.title?.toLowerCase() ?? "";
        const bTitle = b.item.title?.toLowerCase() ?? "";
        const rank = (title: string) =>
          title.startsWith(ql) ? 0 : title.includes(ql) ? 1 : 2;
        const diff = rank(aTitle) - rank(bTitle);
        if (diff !== 0) return diff;
        return (a.score ?? 1) - (b.score ?? 1);
      })
      .map((r) => r.item);
  }, [query, fuse, posts]);

  return (
    <div className="mx-auto max-w-7xl px-6">
      <div className="flex justify-center mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, autor o tonalidad..."
          className="font-label w-full max-w-md px-4 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/30 bg-transparent focus:outline-none focus:ring-2 focus:ring-[#00bfff]/50 text-sm lg:text-base placeholder:text-gray-400"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-5">
        {filtered.length > 0 ? (
          filtered.map((post) => <PostComponent key={post._id} post={post} />)
        ) : (
          <p className="col-span-full text-center font-label text-sm text-gray-400 py-10">
            No se encontraron canciones.
          </p>
        )}
      </div>
    </div>
  );
}
