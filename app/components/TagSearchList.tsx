"use client";

import { useState } from "react";
import { Tag } from "../utils/interface";
import Link from "next/link";

interface Props {
  tags: Tag[];
}

export default function TagSearchList({ tags }: Props) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? tags.filter((t) =>
        t.name.toLowerCase().includes(query.toLowerCase())
      )
    : tags;

  return (
    <div className="mx-auto max-w-7xl px-6 pt-10">
      <div className="flex justify-center mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar etiquetas..."
          className="font-label w-full max-w-md px-4 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/30 bg-transparent focus:outline-none focus:ring-2 focus:ring-[#00bfff]/50 text-sm placeholder:text-gray-400"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.length > 0 ? (
          filtered.map((tag) => (
            <Link key={tag._id} href={`/tag/${tag.slug.current}`}>
              <div className="rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 p-4 hover:border-[#003572]/60 dark:hover:border-[#00bfff]/50 hover:shadow-lg hover:shadow-[#00bfff]/10 transition-all duration-200">
                <h3 className="font-display text-base capitalize mb-1">
                  #{tag.name}
                </h3>
                <p className="font-label text-xs text-gray-400">
                  {tag?.postCount} {tag?.postCount === 1 ? "canción" : "canciones"}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="col-span-full text-center font-label text-sm text-gray-400 py-10">
            No se encontraron etiquetas.
          </p>
        )}
      </div>
    </div>
  );
}
