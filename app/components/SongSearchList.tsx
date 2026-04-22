"use client";

import { useState } from "react";
import { Post } from "../utils/interface";
import PostComponent from "./PostComponent";

interface Props {
  posts: Post[];
}

export default function SongSearchList({ posts }: Props) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? posts.filter(
        (p) =>
          p.title?.toLowerCase().includes(query.toLowerCase()) ||
          p.author?.toLowerCase().includes(query.toLowerCase()) ||
          p.key?.toLowerCase().includes(query.toLowerCase())
      )
    : posts;

  return (
    <div className="mx-auto max-w-7xl px-6">
      <div className="flex justify-center mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, autor o tonalidad..."
          className="font-label w-full max-w-md px-4 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/30 bg-transparent focus:outline-none focus:ring-2 focus:ring-[#00bfff]/50 text-sm placeholder:text-gray-400"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
