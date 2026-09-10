"use client";
// app/components/LibraryIndex.tsx
// The /biblioteca client index (spec §12.2, §18): search console, A–Z sections of
// rows, and the letter rail. All filtering is client-side over one fetched
// catalogue — the URL only mirrors the state so a view is shareable.
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Post, Tag, Author } from "@/app/utils/interface";
import {
  applyLibraryFilters,
  groupByLetter,
  makeLibraryFuse,
  serializeLibraryParams,
  type LibraryFilters,
} from "@/app/utils/libraryIndex";
import AnimatedList from "./ui/AnimatedList";
import Button from "./ui/Button";
import LibraryRow from "./LibraryRow";

export type LibraryIndexProps = { posts: Post[]; tags: Tag[]; authors: Author[]; initial: LibraryFilters };

// The navbar is `sticky top-0` with a fixed h-20/lg:h-24 body under the safe-area
// inset, and publishes no `--navbar-h`; this is the same offset SectionNav uses.
const UNDER_NAVBAR =
  "top-[calc(5rem+env(safe-area-inset-top))] lg:top-[calc(6rem+env(safe-area-inset-top))] " +
  "scroll-mt-[calc(5rem+env(safe-area-inset-top))] lg:scroll-mt-[calc(6rem+env(safe-area-inset-top))]";

// `tags` and `authors` stay in the props type but are read off `props` in Task 4
// (the filter drawer) — destructuring them here would be an unused binding.
export default function LibraryIndex(props: LibraryIndexProps) {
  const { posts, initial } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<LibraryFilters>(initial);
  const fuse = useMemo(() => makeLibraryFuse(posts), [posts]);

  // URL mirrors the filters (shareable; the /tag* and /author* redirects land
  // here with them set). replace, not push — typing must not grow history.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const qs = serializeLibraryParams(filters);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  const filtered = useMemo(() => applyLibraryFilters(posts, filters, fuse), [posts, filters, fuse]);
  const active = !!(filters.q || filters.tags.length || filters.author || filters.key);
  // A query orders by relevance, so the letter sections only exist when idle.
  const groups = useMemo(
    () => (filters.q ? [{ letter: "", posts: filtered }] : groupByLetter(filtered)),
    [filtered, filters.q],
  );
  const letters = useMemo(() => groups.map((g) => g.letter).filter(Boolean), [groups]);

  const jump = useCallback((letter: string) => {
    document.getElementById(`letra-${letter}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const set = (next: LibraryFilters) => setFilters(next);
  const clear = () => setFilters({ q: "", tags: [], author: "", key: "" });

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 pt-8">
      <div className="mb-6 flex items-center gap-2">
        <div className="brand-search-console relative flex-1">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-accent/65"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => set({ ...filters, q: e.target.value })}
            // The ONE count on this surface (spec §18) lives in the placeholder.
            placeholder={`Buscar entre ${posts.length} canciones`}
            aria-label="Buscar canciones por título, artista o tonalidad"
            className="w-full bg-transparent py-3 pl-10 pr-3 font-label text-sm text-ink placeholder:text-placeholder focus:outline-none"
          />
        </div>
        {/* Task 4: <LibraryFilters filters={filters} onChange={set} tags={props.tags} authors={props.authors} keys={libraryKeys(posts)} /> */}
      </div>

      {active && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-ink-dim" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
          </p>
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpiar
          </Button>
        </div>
      )}

      <div className="relative">
        {letters.length > 1 && (
          // FIRST in DOM on purpose: a float only sits beside the content that
          // FOLLOWS it — after the sections it would land under them. The offset is
          // viewport-relative (`50vh`) because a percentage inset on a sticky box
          // resolves against the CONTAINING BLOCK, and this container is thousands of
          // pixels tall — `top-1/2` would park the rail off-screen instead of centring
          // it. Plain <button>s by the same row exemption the plan records: bare tap
          // targets in a rail, not the Button primitive's chrome.
          <nav
            aria-label="Índice alfabético"
            className="sticky top-[50vh] float-right -mr-1 flex -translate-y-1/2 flex-col items-center"
          >
            {letters.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => jump(l)}
                className="px-1.5 py-px font-label text-[10px] text-ink-dim hover:text-accent focus:outline-none focus-visible:text-accent"
                aria-label={`Ir a la letra ${l}`}
              >
                {l}
              </button>
            ))}
          </nav>
        )}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-mono-400">
            <p className="font-label text-sm uppercase tracking-widest">No se encontraron canciones</p>
          </div>
        ) : (
          <div className={letters.length > 1 ? "pr-6" : ""}>
            {groups.map((g) => (
              <section key={g.letter || "resultados"} aria-label={g.letter ? `Letra ${g.letter}` : "Resultados"}>
                {g.letter && (
                  <h2
                    id={`letra-${g.letter}`}
                    className={`sticky ${UNDER_NAVBAR} z-[1] bg-surface-base/90 py-1 font-display text-lg text-accent backdrop-blur-sm`}
                  >
                    {g.letter}
                  </h2>
                )}
                <AnimatedList
                  as="ul"
                  className="divide-y divide-ink-dim/[0.06]"
                  items={g.posts.map((p) => ({ key: p._id, node: <LibraryRow post={p} /> }))}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
