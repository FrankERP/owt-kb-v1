"use client";
// app/components/LibraryIndex.tsx
// The /biblioteca client index (spec §12.2, §18): search console, A–Z sections of
// rows, and the letter rail. All filtering is client-side over one fetched
// catalogue — the URL only mirrors the state so a view is shareable.
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import type { Post, Tag, Author } from "@/app/utils/interface";
import {
  applyLibraryFilters,
  groupByLetter,
  libraryKeys,
  makeLibraryFuse,
  serializeLibraryParams,
  type LibraryFilters as LibraryFiltersState,
} from "@/app/utils/libraryIndex";
import AnimatedList from "./ui/AnimatedList";
import Button from "./ui/Button";
import LibraryFilters from "./LibraryFilters";
import LibraryLetterRail from "./LibraryLetterRail";
import LibraryRow from "./LibraryRow";

export type LibraryIndexProps = { posts: Post[]; tags: Tag[]; authors: Author[]; initial: LibraryFiltersState };

// The navbar is `sticky top-0` with a fixed h-20/lg:h-24 body under the safe-area
// inset, and publishes no `--navbar-h`; this is the same offset SectionNav uses.
const UNDER_NAVBAR =
  "top-[calc(5rem+env(safe-area-inset-top))] lg:top-[calc(6rem+env(safe-area-inset-top))] " +
  "scroll-mt-[calc(5rem+env(safe-area-inset-top))] lg:scroll-mt-[calc(6rem+env(safe-area-inset-top))]";

// Where the "which letter is in view" band starts, in px from the top of the
// viewport. Deliberately ABOVE the sticky offset above (80 px on a phone, 96 on
// a desktop, plus the inset) — `rootMargin` takes no `env()`, and a band that
// began exactly at the offset would leave the pinned heading on its edge.
const BAND_TOP_PX = 64;

export default function LibraryIndex(props: LibraryIndexProps) {
  const { posts, tags, authors, initial } = props;
  const pathname = usePathname();
  const [filters, setFilters] = useState<LibraryFiltersState>(initial);
  const fuse = useMemo(() => makeLibraryFuse(posts), [posts]);
  const keys = useMemo(() => libraryKeys(posts), [posts]);

  // URL mirrors the filters (shareable; the /tag* and /author* redirects land
  // here with them set). `history.replaceState`, deliberately, not the router —
  // the `AdminPanel.tsx` `?tab=` precedent (~line 671): `router.replace`
  // re-renders the route segment, which for this page means re-running the
  // Server Component's fetch on every keystroke for a purely local, client-side
  // filter. Rewriting the current history entry keeps the URL honest for
  // reload/Back with no round-trip and no navigation at all. replace, not push
  // — typing must not grow history. The cost, same as AdminPanel's: Next's router
  // never learns the new URL, so tapping the already-active Biblioteca tab after
  // typing pushes a bare /biblioteca while this list keeps its query (R1 ruling:
  // a reload resyncs; not worth a server round-trip per keystroke).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const qs = serializeLibraryParams(filters);
    window.history.replaceState(window.history.state, "", qs ? `${pathname}?${qs}` : pathname);
  }, [filters, pathname]);

  const filtered = useMemo(() => applyLibraryFilters(posts, filters, fuse), [posts, filters, fuse]);
  const active = !!(filters.q || filters.tags.length || filters.author || filters.key);
  // A query orders by relevance, so the letter sections only exist when idle.
  const groups = useMemo(
    () => (filters.q ? [{ letter: "", posts: filtered }] : groupByLetter(filtered)),
    [filtered, filters.q],
  );
  const letters = useMemo(() => groups.map((g) => g.letter).filter(Boolean), [groups]);

  // The rail is an index BAR: it shows where the list is, so the active letter
  // has to be optimistic on a jump (the scrub must track the finger, not the
  // scroll animation) and authoritative from the observer afterwards. The
  // "nothing is current" case is DERIVED, never stored — a query collapses the
  // sections, and a remembered letter that no longer has a section would
  // otherwise light up the moment the sections come back, ahead of the observer.
  const [seenLetter, setSeenLetter] = useState("");
  const activeLetter = letters.includes(seenLetter) ? seenLetter : "";

  const jump = useCallback((letter: string, behavior: ScrollBehavior = "smooth") => {
    setSeenLetter(letter);
    document.getElementById(`letra-${letter}`)?.scrollIntoView({ block: "start", behavior });
  }, []);

  // ONE IntersectionObserver over the headings, never a scroll listener: the
  // band starts ABOVE the sticky offset (5–6 rem + inset) and ends well short of
  // the fold, so the heading pinned under the navbar is the one inside it. Two
  // can intersect at once while the next section pushes the current one out —
  // `letters` order breaks that tie in favour of the pinned one. When nothing
  // intersects (a long section scrolled past its own heading) the last heading
  // above the band wins, which is the section the reader is actually in.
  useEffect(() => {
    if (letters.length < 2 || typeof IntersectionObserver === "undefined") return;
    const els = letters
      .map((l) => document.getElementById(`letra-${l}`))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const letterOf = (el: Element) => el.id.slice("letra-".length);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(letterOf(e.target));
          else visible.delete(letterOf(e.target));
        }
        const inView = letters.find((l) => visible.has(l));
        if (inView) {
          setSeenLetter(inView);
          return;
        }
        const passed = els.filter((el) => el.getBoundingClientRect().top < BAND_TOP_PX);
        setSeenLetter(passed.length ? letterOf(passed[passed.length - 1]) : letters[0]);
      },
      { rootMargin: `-${BAND_TOP_PX}px 0px -70% 0px` },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [letters]);

  const set = (next: LibraryFiltersState) => setFilters(next);
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
        <LibraryFilters filters={filters} onChange={set} tags={tags} authors={authors} keys={keys} />
      </div>

      {/* Always mounted so a screen reader keeps ONE live region to announce
          into — mounting/unmounting it on `active` drops the announcement of
          the very change that flips `active`. Text is empty, not absent, when
          idle; Limpiar stays conditional since it has nothing to do idle. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-label text-[11px] uppercase tracking-widest text-ink-dim" aria-live="polite">
          {active ? `${filtered.length} ${filtered.length === 1 ? "resultado" : "resultados"}` : ""}
        </p>
        {active && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpiar
          </Button>
        )}
      </div>

      <div className="relative">
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
        {letters.length > 1 && (
          // AFTER the sections, deliberately — the rail positions itself
          // `absolute` inside the `relative` wrapper above, not as a float, so
          // DOM order no longer places it: the wrapper's `pr-6` gutter is what
          // it sits in. Its own chrome, scrub and progress live in the component.
          <LibraryLetterRail letters={letters} active={activeLetter} onJump={jump} />
        )}
      </div>
    </div>
  );
}
