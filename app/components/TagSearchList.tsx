"use client";

import { useState, useMemo } from "react";
import { Tag } from "../utils/interface";
import { normalizeText } from "../utils/normalizeText";
import Link from "next/link";

type SortMode = "popular" | "alpha";

// Pinned quick-access tags (slugs must match Sanity exactly)
const PINNED: Array<{
  slug: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    slug: "up-beat",
    label: "Up Beat",
    hint: "Canciones energéticas",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
  {
    slug: "down-beat",
    label: "Down Beat",
    hint: "Canciones contempl.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
      </svg>
    ),
  },
  {
    slug: "transition",
    label: "Transition",
    hint: "Canciones de enlace",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
];

export default function TagSearchList({ tags }: { tags: Tag[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");

  const isSearching = query.trim().length > 0;

  const maxCount = useMemo(
    () => Math.max(1, ...tags.map((t) => t.postCount ?? 0)),
    [tags]
  );

  const totalSongs = useMemo(
    () => tags.reduce((sum, t) => sum + (t.postCount ?? 0), 0),
    [tags]
  );

  // Tags to show in the main grid (pinned ones excluded when not searching)
  const gridTags = useMemo(() => {
    const pinnedSlugs = new Set(PINNED.map((p) => p.slug));
    const nq = normalizeText(query);
    const base = isSearching
      ? tags.filter((t) => normalizeText(t.name).includes(nq))
      : tags.filter((t) => !pinnedSlugs.has(t.slug.current));

    return [...base].sort((a, b) => {
      if (sort === "alpha") return a.name.localeCompare(b.name);
      return (b.postCount ?? 0) - (a.postCount ?? 0);
    });
  }, [query, sort, tags, isSearching]);

  // Resolve pinned tags from the fetched list (so postCount is populated)
  const pinnedResolved = useMemo(
    () =>
      PINNED.map((p) => ({
        ...p,
        tag: tags.find((t) => t.slug.current === p.slug),
      })),
    [tags]
  );

  return (
    <div className="mx-auto max-w-7xl px-6 pt-8 pb-20 space-y-10">

      {/* ── Stats + Controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Stats */}
        <div className="flex items-baseline gap-4 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{tags.length}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">etiquetas</span>
          </div>
          <span className="text-gray-700 text-sm">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{totalSongs}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">canciones</span>
          </div>
        </div>

        {/* Sort + Search */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 overflow-hidden">
            {(["popular", "alpha"] as SortMode[]).map((mode, i) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                className={`px-3 py-1.5 font-label text-[10px] uppercase tracking-widest transition-colors duration-150
                  ${i > 0 ? "border-l border-[#003572]/20 dark:border-[#00bfff]/15" : ""}
                  ${sort === mode
                    ? "bg-[#00bfff]/15 text-[#00bfff]"
                    : "text-gray-500 hover:text-gray-300 hover:bg-[#00bfff]/5"
                  }`}
              >
                {mode === "popular" ? "Popular" : "A–Z"}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="font-label pl-8 pr-3 py-1.5 rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 bg-transparent focus:outline-none focus:border-[#00bfff] text-sm placeholder:text-gray-600 transition-colors w-36 sm:w-48"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
      </div>

      {/* ── Pinned quick-access (hidden while searching) ── */}
      {!isSearching && (
        <div className="space-y-3">
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-600">Tipo de canción</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pinnedResolved.map(({ slug, label, hint, icon, tag }) => {
              const count = tag?.postCount ?? 0;
              const pct = Math.round((count / maxCount) * 100);
              return (
                <Link key={slug} href={`/tag/${slug}`}>
                  <div className="relative group overflow-hidden rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 p-5 hover:border-[#003572]/60 dark:hover:border-[#00bfff]/50 hover:shadow-xl hover:shadow-[#00bfff]/15 transition-all duration-300 cursor-pointer">
                    {/* Ambient glow */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-[#00bfff]/[0.05] to-transparent pointer-events-none rounded-xl" />
                    {/* Progress bar */}
                    <div
                      className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-[#00bfff] to-[#003572] transition-all duration-500 group-hover:h-[3px]"
                      style={{ width: `${Math.max(pct, 12)}%` }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <h3 className="font-display text-xl capitalize leading-tight group-hover:text-[#00bfff] transition-colors duration-200">
                          {label}
                        </h3>
                        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">
                          {hint}
                        </p>
                        {tag && (
                          <p className="font-label text-[10px] text-gray-600">
                            {count} {count === 1 ? "canción" : "canciones"}
                          </p>
                        )}
                      </div>
                      <span className="text-[#00bfff]/40 group-hover:text-[#00bfff]/70 transition-colors duration-200 shrink-0 mt-0.5">
                        {icon}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── All remaining tags ── */}
      {gridTags.length > 0 && (
        <div className="space-y-3">
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-600">
            {isSearching ? "Resultados" : "Todas las etiquetas"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {gridTags.map((tag) => {
              const pct = Math.round(((tag.postCount ?? 0) / maxCount) * 100);
              return (
                <Link key={tag._id} href={`/tag/${tag.slug.current}`}>
                  <div className="relative group overflow-hidden rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/10 p-4 hover:border-[#003572]/50 dark:hover:border-[#00bfff]/40 hover:shadow-lg hover:shadow-[#00bfff]/10 transition-all duration-200 cursor-pointer">
                    <div
                      className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-[#00bfff]/50 to-[#003572]/30 group-hover:from-[#00bfff]/80 transition-colors duration-200"
                      style={{ width: `${Math.max(pct, 8)}%` }}
                    />
                    <h3 className="font-display text-sm capitalize mb-1 group-hover:text-[#00bfff] transition-colors duration-200 leading-snug">
                      #{tag.name}
                    </h3>
                    <p className="font-label text-[10px] uppercase tracking-widest text-gray-600">
                      {tag.postCount ?? 0}{" "}
                      {(tag.postCount ?? 0) === 1 ? "canción" : "canciones"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {gridTags.length === 0 && isSearching && (
        <div className="flex flex-col items-center gap-3 py-24 text-gray-600">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <p className="font-label text-sm uppercase tracking-widest">No se encontraron etiquetas</p>
        </div>
      )}
    </div>
  );
}
