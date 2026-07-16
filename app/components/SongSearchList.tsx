"use client";

import { useState, useMemo } from "react";
import Fuse, { IFuseOptions } from "fuse.js";
import { Post } from "../utils/interface";
import { normalizeText } from "../utils/normalizeText";
import PostComponent from "./PostComponent";

interface Props {
  posts: Post[];
}

const fuseOptions: IFuseOptions<Post> = {
  keys: [
    { name: "title", weight: 3 },
    { name: "author", weight: 1 },
    { name: "key", weight: 1 },
  ],
  threshold: 0.35,
  distance: 200,
  minMatchCharLength: 2,
  shouldSort: true,
  includeScore: true,
  // Index accent-folded values so "adoracion" matches "Adoración".
  getFn: (obj, path) => {
    const key = Array.isArray(path) ? path[0] : path;
    const val = (obj as unknown as Record<string, unknown>)[key];
    return typeof val === "string" ? normalizeText(val) : "";
  },
};

export default function SongSearchList({ posts }: Props) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(() => new Fuse(posts, fuseOptions), [posts]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return posts;

    const ql = normalizeText(q);

    if (q.length <= 2) {
      // Exact substring match, prefix-first (accent-insensitive)
      return posts
        .filter(
          (p) =>
            normalizeText(p.title).includes(ql) ||
            normalizeText(p.author).includes(ql) ||
            normalizeText(p.key) === ql
        )
        .sort((a, b) => {
          const aTitle = normalizeText(a.title);
          const bTitle = normalizeText(b.title);
          const aStarts = aTitle.startsWith(ql);
          const bStarts = bTitle.startsWith(ql);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return aTitle.localeCompare(bTitle);
        });
    }

    // Fuzzy search for 3+ characters (query + index are accent-folded)
    return fuse
      .search(ql)
      .sort((a, b) => {
        const aTitle = normalizeText(a.item.title);
        const bTitle = normalizeText(b.item.title);
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
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="brand-section-heading">
          <p className="font-label text-[9px] uppercase tracking-[0.22em] text-brand-beam/75">Índice musical</p>
          <p className="mt-1 font-body text-sm text-brand-steel/65">
            {query.trim() ? `${filtered.length} resultados` : `${posts.length} canciones disponibles`}
          </p>
        </div>
        <div className="brand-search-console relative w-full sm:max-w-md">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-beam/55"
            width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título, autor o tonalidad..."
            aria-label="Buscar canciones"
            className="w-full bg-transparent py-3 pl-10 pr-10 font-label text-sm text-brand-frost placeholder:text-brand-steel/45 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-brand-steel/60 transition-colors hover:text-brand-beam focus:outline-none focus:ring-2 focus:ring-brand-beam/50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
        {filtered.length > 0 ? (
          filtered.map((post) => <PostComponent key={post._id} post={post} />)
        ) : (
          <div className="col-span-full flex flex-col items-center gap-3 py-20 text-gray-400">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <p className="font-label text-sm uppercase tracking-widest">No se encontraron canciones</p>
          </div>
        )}
      </div>
    </div>
  );
}
