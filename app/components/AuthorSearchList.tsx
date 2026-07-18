"use client";

import { useState, useMemo } from "react";
import { Author } from "../utils/interface";
import { normalizeText } from "../utils/normalizeText";
import Link from "next/link";

type SortMode = "popular" | "alpha";

export default function AuthorSearchList({ authors, totalSongs }: { authors: Author[]; totalSongs: number }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const isSearching = query.trim().length > 0;

  // totalSongs is the distinct catalog size (server-computed) — NOT the sum of
  // per-author postCounts, which double-counts every multi-author song.

  const grid = useMemo(() => {
    const nq = normalizeText(query);
    const base = isSearching
      ? authors.filter((a) => normalizeText(a.name).includes(nq))
      : authors;
    return [...base].sort((a, b) =>
      sort === "alpha" ? a.name.localeCompare(b.name) : (b.postCount ?? 0) - (a.postCount ?? 0)
    );
  }, [query, sort, authors, isSearching]);

  return (
    <div className="mx-auto max-w-7xl px-6 pt-8 pb-20 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-baseline gap-4 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{authors.length}</span>
            <span className="font-label text-[11px] uppercase tracking-widest text-gray-500">artistas</span>
          </div>
          <span className="text-gray-700 text-sm">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{totalSongs}</span>
            <span className="font-label text-[11px] uppercase tracking-widest text-gray-500">canciones</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 overflow-hidden">
            {(["popular", "alpha"] as SortMode[]).map((mode, i) => (
              <button key={mode} onClick={() => setSort(mode)}
                aria-pressed={sort === mode}
                className={`px-3 py-1.5 font-label text-[11px] uppercase tracking-widest transition-colors duration-150 ${i > 0 ? "border-l border-[#003572]/20 dark:border-[#00bfff]/15" : ""} ${sort === mode ? "bg-[#00bfff]/15 text-[#00bfff]" : "text-gray-500 hover:text-gray-300 hover:bg-[#00bfff]/5"}`}>
                {mode === "popular" ? "Popular" : "A–Z"}
              </button>
            ))}
          </div>
          <div className="relative">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar..."
              className="font-label pl-3 pr-8 py-1.5 rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 bg-transparent focus:outline-none focus:border-[#00bfff] text-sm placeholder:text-gray-600 transition-colors w-36 sm:w-48" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-500 hover:text-[#00bfff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/50 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {grid.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {grid.map((a) => (
            <Link key={a._id} href={`/author/${a.slug.current}`}>
              <div className="relative group overflow-hidden rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/10 p-4 hover:border-[#003572]/50 dark:hover:border-[#00bfff]/40 hover:shadow-lg hover:shadow-[#00bfff]/10 transition-all duration-200 cursor-pointer">
                <h3 className="font-display text-sm mb-1 group-hover:text-[#00bfff] transition-colors duration-200 leading-snug">
                  {a.name}
                </h3>
                <p className="font-label text-[11px] uppercase tracking-widest text-gray-600">
                  {a.postCount ?? 0} {(a.postCount ?? 0) === 1 ? "canción" : "canciones"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-24 text-gray-600">
          <p className="font-label text-sm uppercase tracking-widest">No se encontraron artistas</p>
        </div>
      )}
    </div>
  );
}
