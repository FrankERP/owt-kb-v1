"use client";

import { useState } from "react";
import { Post } from "../utils/interface";
import PostComponent from "./PostComponent";
import { Jura } from "next/font/google";

const labelFont = Jura({ weight: "600", subsets: ["latin"] });

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
    <div>
      <div className="flex justify-center px-4 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, autor o tonalidad..."
          className={`${labelFont.className} w-full max-w-md px-4 py-2 rounded-lg border border-[#003572] dark:border-[#00bfff] bg-transparent focus:outline-none focus:ring-2 focus:ring-[#00bfff] text-sm`}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-4">
        {filtered.length > 0 ? (
          filtered.map((post) => <PostComponent key={post._id} post={post} />)
        ) : (
          <p className="col-span-full text-center text-gray-500 py-8">
            No se encontraron canciones.
          </p>
        )}
      </div>
    </div>
  );
}
