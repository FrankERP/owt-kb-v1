# R1 — Home run sheet + Biblioteca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The library leaves the home page for its own route `/biblioteca` (an A–Z index of 56 px rows with a search console and a filter drawer; `/tag*` and `/author*` redirect into it), and home becomes the run sheet: the next service in full, every other service collapsed to one line.

**Architecture:** Pure library logic (`app/utils/libraryIndex.ts`) is a neutral module the page and the client index both import. One new primitive, `AnimatedList` (`ui/`), owns the `layout` reflow so `motion` stays behind the import boundary. `DayCard` keeps its data contract and gains a run-sheet header, a `wide` layout and a hero action; home composes it with a `Collapse` disclosure for the non-next services. Redirects are `next.config.mjs` `redirects()` (permanent = 308, the modern 301). The lit card (§23) is ~30 lines of CSS keyed on `data-lit`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 3.4, `motion` 13.2 (`motion/react-m`, LazyMotion `domMax` already loaded), Fuse.js, vitest + RTL (jsdom), Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — §12.1 (run sheet), §12.2 (Biblioteca), §12.8 (eyebrow removal), §14 (phase table, before/after shots), §17 (library row = Contenido's row, key badge left, chips `+N`), §18 (label budget table), §19.2 (rows), §23 (lit card, decision Q), Part IV decisions G, H, N, Q. Deferred by Part IX to R7: long-press quick actions, pull-to-refresh — NOT in this plan.

## Global Constraints

- Gates before any commit: `npx tsc --noEmit`, FULL `npx vitest run`, `npx eslint .` with 0 errors (Node 22: `export PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`). Every task runs the full suite.
- `motion` is importable only under `app/components/ui/**` (`motionImportBoundary.test.ts`). Server Components never CALL a value from a `"use client"` module (`clientBoundary.test.ts`, ADR-0028).
- `Button` for every button except list rows, which follow DayCard's setlist-row pattern (`<li><button …>`); every dialog is `<CueDialog open={variable}>` (`cueDialogMount.test.ts` baseline 10 → 11 in Task 4); every disclosure is `Collapse`; every animated conditional is `Presence`; every loading placeholder is `Skeleton`.
- Label budget (§18): `>Servicio<`, `Índice musical`, `títulos` go to 0 in `labelBudget.test.ts` in the same commit that removes them; `Repertorio` joins at 0.
- Colour: tokens only; `node scripts/colour-inventory.mjs` after every `brand.css`/app-file colour change, fixture committed; `lightContrast.test.ts` pins per file — drop the `SongSearchList` pin when the file goes.
- Timezone: dates render pinned to local noon (`new Date(iso.slice(0,10)+"T12:00:00")`); countdown labels use a calendar-day diff at local noon (`daysUntil`).
- Member-facing reads keep their existing filters (posts have no `published` field; role reads keep `published != false`).
- Spanish UI. Conventional commits, no AI attribution. Docs current in the same task that changes behaviour.
- Bundle: measured at Task 10 with the cold same-environment A/B method (`docs/MOTION.md` ledger); recorded, not gated (Part IX ruling).

---

### Task 1: Library logic as a neutral module

**Files:**
- Create: `app/utils/libraryIndex.ts`
- Create: `app/utils/__tests__/libraryIndex.test.ts`

**Interfaces:**
- Produces: `TIPO_SLUGS`, `LibraryFilters`, `parseLibraryParams(sp)`, `serializeLibraryParams(f)`, `searchPosts(posts, q, fuse?)`, `applyLibraryFilters(posts, f, fuse?)`, `groupByLetter(posts)`, `libraryKeys(posts)`, `makeLibraryFuse(posts)`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/utils/__tests__/libraryIndex.test.ts
import { describe, it, expect } from "vitest";
import {
  parseLibraryParams, serializeLibraryParams, applyLibraryFilters, groupByLetter, libraryKeys, TIPO_SLUGS,
} from "../libraryIndex";
import type { Post } from "../interface";

const tag = (slug: string) => ({ _id: `t-${slug}`, name: slug, slug: { current: slug } });
const post = (title: string, extra: Partial<Post> = {}): Post =>
  ({ _id: title, title, author: "", slug: { current: title }, key: "", bpm: "", timeSig: "", tags: [], ...extra } as unknown as Post);

const POSTS = [
  post("Ánclame", { author: "Marco", key: "G", tags: [tag("up-beat"), tag("amor")] }),
  post("Alaba", { author: "Elevation", key: "A", tags: [tag("down-beat")] }),
  post("10,000 razones", { author: "Redman", key: "G", tags: [tag("gratitud")], authors: [{ _id: "a1", name: "Redman", slug: { current: "redman" } }] }),
  post("Bueno es", { author: "Hillsong", key: "D", tags: [tag("up-beat"), tag("amor")] }),
];

describe("parseLibraryParams / serializeLibraryParams", () => {
  it("reads q, tag (comma list), author, key; ignores unknown keys", () => {
    expect(parseLibraryParams({ q: "ala", tag: "up-beat,amor", author: "redman", key: "G", x: "1" }))
      .toEqual({ q: "ala", tags: ["up-beat", "amor"], author: "redman", key: "G" });
  });
  it("round-trips and omits empty fields", () => {
    expect(serializeLibraryParams({ q: "", tags: ["amor"], author: "", key: "" })).toBe("tag=amor");
    expect(serializeLibraryParams({ q: "a b", tags: [], author: "", key: "" })).toBe("q=a+b");
    expect(serializeLibraryParams(parseLibraryParams({}))).toBe("");
  });
});

describe("applyLibraryFilters", () => {
  it("no filters → every post, A–Z by folded title", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({})).map((p) => p.title))
      .toEqual(["10,000 razones", "Alaba", "Ánclame", "Bueno es"]);
  });
  it("tags are AND-ed", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ tag: "up-beat,amor" })).map((p) => p.title))
      .toEqual(["Ánclame", "Bueno es"]);
  });
  it("author matches the reference slug OR the legacy author string, accent-insensitive", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ author: "redman" }))).toHaveLength(1);
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ author: "Elevation" }))).toHaveLength(1);
  });
  it("key is exact", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ key: "G" }))).toHaveLength(2);
  });
  it("short queries are accent-insensitive prefix-first substring matches", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ q: "an" })).map((p) => p.title)).toEqual(["Ánclame"]);
  });
  it("3+ char queries are fuzzy and keep prefix matches first", () => {
    const titles = applyLibraryFilters(POSTS, parseLibraryParams({ q: "alab" })).map((p) => p.title);
    expect(titles[0]).toBe("Alaba");
  });
});

describe("groupByLetter", () => {
  it("groups by folded first letter, digits under #, sections in A–Z order with # last", () => {
    const groups = groupByLetter(applyLibraryFilters(POSTS, parseLibraryParams({})));
    expect(groups.map((g) => g.letter)).toEqual(["A", "B", "#"]);
    expect(groups[0].posts.map((p) => p.title)).toEqual(["Alaba", "Ánclame"]);
  });
});

describe("libraryKeys / TIPO_SLUGS", () => {
  it("lists distinct keys sorted, blanks dropped", () => {
    expect(libraryKeys(POSTS)).toEqual(["A", "D", "G"]);
  });
  it("pins the three Tipo slugs", () => {
    expect(TIPO_SLUGS).toEqual(["up-beat", "down-beat", "transition"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run app/utils/__tests__/libraryIndex.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// app/utils/libraryIndex.ts
// Pure library logic (spec §12.2). NEUTRAL module — no React, no "use client" —
// so the /biblioteca Server Component and the client index share one truth.
// Search is the former SongSearchList's algorithm, moved here unchanged:
// ≤2 chars → accent-folded substring, prefix first; 3+ → Fuse, prefix first.
import Fuse, { IFuseOptions } from "fuse.js";
import type { Post } from "./interface";
import { normalizeText } from "./normalizeText";

export const TIPO_SLUGS = ["up-beat", "down-beat", "transition"] as const;

export type LibraryFilters = { q: string; tags: string[]; author: string; key: string };

export function parseLibraryParams(sp: Record<string, string | string[] | undefined>): LibraryFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  return {
    q: one(sp.q).trim(),
    tags: one(sp.tag).split(",").map((s) => s.trim()).filter(Boolean),
    author: one(sp.author).trim(),
    key: one(sp.key).trim(),
  };
}

export function serializeLibraryParams(f: LibraryFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.tags.length) p.set("tag", f.tags.join(","));
  if (f.author) p.set("author", f.author);
  if (f.key) p.set("key", f.key);
  return p.toString();
}

const FUSE: IFuseOptions<Post> = {
  keys: [{ name: "title", weight: 3 }, { name: "author", weight: 1 }, { name: "key", weight: 1 }],
  threshold: 0.35, distance: 200, minMatchCharLength: 2, shouldSort: true, includeScore: true,
  getFn: (obj, path) => {
    const key = Array.isArray(path) ? path[0] : path;
    const val = (obj as unknown as Record<string, unknown>)[key];
    return typeof val === "string" ? normalizeText(val) : "";
  },
};

export function makeLibraryFuse(posts: Post[]): Fuse<Post> { return new Fuse(posts, FUSE); }

export function searchPosts(posts: Post[], q: string, fuse: Fuse<Post> = makeLibraryFuse(posts)): Post[] {
  const raw = q.trim();
  if (!raw) return posts;
  const ql = normalizeText(raw);
  if (raw.length <= 2) {
    return posts
      .filter((p) => normalizeText(p.title).includes(ql) || normalizeText(p.author ?? "").includes(ql) || normalizeText(p.key ?? "") === ql)
      .sort((a, b) => {
        const at = normalizeText(a.title), bt = normalizeText(b.title);
        const as = at.startsWith(ql), bs = bt.startsWith(ql);
        if (as !== bs) return as ? -1 : 1;
        return at.localeCompare(bt);
      });
  }
  return fuse.search(ql)
    .sort((a, b) => {
      const rank = (t: string) => (t.startsWith(ql) ? 0 : t.includes(ql) ? 1 : 2);
      const d = rank(normalizeText(a.item.title)) - rank(normalizeText(b.item.title));
      return d !== 0 ? d : (a.score ?? 1) - (b.score ?? 1);
    })
    .map((r) => r.item);
}

const byTitle = (a: Post, b: Post) => normalizeText(a.title).localeCompare(normalizeText(b.title));

export function applyLibraryFilters(posts: Post[], f: LibraryFilters, fuse?: Fuse<Post>): Post[] {
  let out = posts;
  if (f.tags.length) out = out.filter((p) => f.tags.every((slug) => (p.tags ?? []).some((t) => t.slug?.current === slug)));
  if (f.author) {
    const a = normalizeText(f.author);
    out = out.filter((p) => (p.authors ?? []).some((x) => x.slug?.current === f.author) || normalizeText(p.author ?? "") === a);
  }
  if (f.key) out = out.filter((p) => (p.key ?? "").trim() === f.key);
  // A query orders by relevance; otherwise A–Z on the folded title.
  return f.q ? searchPosts(out, f.q, fuse && out === posts ? fuse : undefined) : [...out].sort(byTitle);
}

export type LetterGroup = { letter: string; posts: Post[] };

export function groupByLetter(posts: Post[]): LetterGroup[] {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    const c = normalizeText(p.title).trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(c) ? c : "#";
    (map.get(letter) ?? map.set(letter, []).get(letter)!).push(p);
  }
  const letters = [...map.keys()].filter((l) => l !== "#").sort();
  if (map.has("#")) letters.push("#");
  return letters.map((letter) => ({ letter, posts: [...map.get(letter)!].sort(byTitle) }));
}

export function libraryKeys(posts: Post[]): string[] {
  return [...new Set(posts.map((p) => (p.key ?? "").trim()).filter(Boolean))].sort();
}
```

- [ ] **Step 4: Run the test → PASS**, then the full suite.
- [ ] **Step 5: Commit** — `feat(library): pure index logic — params, filters, search, A–Z groups`

---

### Task 2: `AnimatedList` primitive

**Files:**
- Create: `app/components/ui/AnimatedList.tsx`
- Create: `app/components/ui/__tests__/AnimatedList.test.tsx`
- Modify: `docs/MOTION.md` (primitives table: one row)

**Interfaces:**
- Produces: `<AnimatedList as="ul" className items={[{ key, node }]} itemClassName />` — renders `<as>` with one `m.li layout` per item; leavers fade over `MS.fast`; `initial={false}` so first paint is static. Consumed by Task 3.

- [ ] **Step 1: Failing test**

```tsx
// app/components/ui/__tests__/AnimatedList.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AnimatedList from "../AnimatedList";
import { withMotion } from "./motionTestSetup"; // use whatever wrapper the sibling tests use (see Presence.test.tsx)

describe("AnimatedList", () => {
  it("renders one list item per entry, in order, inside the requested host", () => {
    render(withMotion(<AnimatedList as="ul" items={[{ key: "a", node: "Alaba" }, { key: "b", node: "Bueno" }]} />));
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Alaba", "Bueno"]);
    expect(items[0].closest("ul")).not.toBeNull();
  });
  it("keeps semantics: the host is the list, items carry the item class", () => {
    render(withMotion(<AnimatedList as="ol" itemClassName="row" items={[{ key: "a", node: "x" }]} />));
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getByRole("listitem").className).toContain("row");
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

```tsx
"use client";
// app/components/ui/AnimatedList.tsx
// The one list-reflow primitive (spec §12.2, §5.1): filtered rows slide to their
// new place (`layout`), leavers fade in --motion-fast, newcomers fade in. Under
// `domMax` (already loaded) `layout` is available; before the feature chunk
// arrives the list simply renders static. `initial={false}` keeps first paint
// still — no 142 rows flying in. The host stays a real <ul>/<ol> for semantics.
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { MS, EASE_OUT } from "@/app/utils/motionPresets";

export type AnimatedItem = { key: string; node: React.ReactNode };

export default function AnimatedList({
  items, as: Host = "ul", className = "", itemClassName = "",
}: { items: AnimatedItem[]; as?: "ul" | "ol"; className?: string; itemClassName?: string }) {
  return (
    <Host className={className}>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <m.li
            key={it.key}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: MS.fast / 1000 } }}
            transition={{ duration: MS.base / 1000, ease: EASE_OUT }}
            className={itemClassName}
          >
            {it.node}
          </m.li>
        ))}
      </AnimatePresence>
    </Host>
  );
}
```

- [ ] **Step 4: Run → PASS**; full suite (the `motionImportBoundary` guard must stay green — the file is under `ui/`).
- [ ] **Step 5: Docs** — add the row to `docs/MOTION.md`'s primitives table: `AnimatedList` | list reflow: `layout="position"` per row, leavers fade `fast` | `/biblioteca` index.
- [ ] **Step 6: Commit** — `feat(motion): AnimatedList — the one list-reflow primitive`

---

### Task 3: `/biblioteca` — route, index, rows, letter rail

**Files:**
- Create: `app/(client)/biblioteca/page.tsx`, `app/(client)/biblioteca/loading.tsx`
- Create: `app/components/LibraryIndex.tsx`, `app/components/LibraryRow.tsx`
- Create: `app/components/__tests__/libraryIndex.test.tsx`
- Modify: `app/utils/revalidate.ts` (`revalidateSongViews`)

**Interfaces:**
- Consumes: Task 1 (`applyLibraryFilters`, `groupByLetter`, `parseLibraryParams`, `serializeLibraryParams`, `makeLibraryFuse`, `libraryKeys`, `TIPO_SLUGS`), Task 2 (`AnimatedList`), `usePlayer().openSheet(id)`.
- Produces: `LibraryIndex` props `{ posts: Post[]; tags: Tag[]; authors: Author[]; initial: LibraryFilters }`; Task 4 adds `<LibraryFilters>` right of the search console (a comment marks the spot; no render prop — a function cannot cross the Server→Client boundary).

- [ ] **Step 1: Page (server)**

```tsx
// app/(client)/biblioteca/page.tsx
import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import LibraryIndex from "@/app/components/LibraryIndex";
import { client } from "@/sanity/lib/client";
import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { parseLibraryParams } from "@/app/utils/libraryIndex";
import type { Post, Tag, Author } from "@/app/utils/interface";

export const metadata: Metadata = { title: "Biblioteca — Oasis Worship Team", description: "Todas las canciones, por título, artista, tonalidad y tema." };
export const revalidate = 60;

// One fetch: the catalogue (the former home POSTS_QUERY, plus author refs), the
// tags with counts (the former /tag query) and the authors (the former /author).
const QUERY = `{
  "posts": *[_type == "post"] | order(title asc) {
    _id, _createdAt, title, author, slug, publishDate, timeSig, bpm, key,
    tags[]->{ _id, slug, name }, authors[]->{ _id, slug, name }
  },
  "tags": *[_type == "tag"] | order(name asc) { _id, name, slug, "postCount": count(*[_type == "post" && ^._id in tags[]._ref]) },
  "authors": *[_type == "author"] | order(name asc) { _id, name, slug, "postCount": count(*[_type == "post" && ^._id in authors[]._ref]) }
}`;

export default async function BibliotecaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorshipPage("/biblioteca");
  const sp = await searchParams;
  const data = await client.fetch<{ posts: Post[]; tags: Tag[]; authors: Author[] }>(QUERY);
  return (
    <div>
      <Navbar title="Biblioteca" tags schedule />
      <LibraryIndex posts={data.posts ?? []} tags={data.tags ?? []} authors={data.authors ?? []} initial={parseLibraryParams(sp)} />
    </div>
  );
}
```

Note: `searchParams` makes the page dynamic per request; keep `revalidate = 60` for the fetch cache (`client.fetch` honours it). The GROQ result does not depend on the params — filtering is client-side — so the fetch is shared across param values.

- [ ] **Step 2: Row (client)** — Contenido's row (`ContentPanel.tsx:221-267`) adapted per §17: key badge LEFT, BPM right, chips `+N` on phones.

```tsx
"use client";
// app/components/LibraryRow.tsx
import { memo } from "react";
import type { Post } from "@/app/utils/interface";
import { usePlayer } from "@/app/context/PlayerContext";

// The library row (spec §12.2, §17, §19.2): key · title/artist · BPM · tags.
// A <button> in an <li>, like DayCard's setlist rows — the row IS the affordance
// (no eyebrow, no "Ver"). Memoised: ~140 rows share one player context.
const LibraryRow = memo(function LibraryRow({ post }: { post: Post }) {
  const { openSheet } = usePlayer();
  const tags = post.tags ?? [];
  return (
    <button
      type="button"
      onClick={() => openSheet(post._id)}
      aria-label={`${post.title}${post.author ? `, ${post.author}` : ""}${post.key ? `, tonalidad ${post.key}` : ""}`}
      className="group flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-fast ease-out-brand hover:bg-accent/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="brand-key-dial shrink-0 font-display text-sm uppercase">{post.key || "—"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-base font-semibold text-ink transition-colors group-hover:text-accent">{post.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          {post.author && <span className="truncate font-body text-xs text-ink-dim">{post.author}</span>}
          {tags.length > 0 && (
            <span className="hidden min-w-0 items-center gap-1 sm:flex">
              {tags.slice(0, 3).map((t) => <span key={t._id} className="rounded-full bg-accent/10 px-1.5 py-px font-label text-[10px] lowercase text-ink-dim">#{t.name}</span>)}
              {tags.length > 3 && <span className="font-label text-[10px] text-ink-dim">+{tags.length - 3}</span>}
            </span>
          )}
          {tags.length > 0 && <span className="font-label text-[10px] text-ink-dim sm:hidden">#{tags[0].name}{tags.length > 1 ? ` +${tags.length - 1}` : ""}</span>}
        </span>
      </span>
      {post.bpm && <span className="shrink-0 font-label text-[11px] uppercase tracking-widest text-ink-dim tabular-nums">{post.bpm} BPM</span>}
    </button>
  );
});
export default LibraryRow;
```

- [ ] **Step 3: Index (client)**

```tsx
"use client";
// app/components/LibraryIndex.tsx
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { Post, Tag, Author } from "@/app/utils/interface";
import { applyLibraryFilters, groupByLetter, makeLibraryFuse, serializeLibraryParams, type LibraryFilters } from "@/app/utils/libraryIndex";
import AnimatedList from "./ui/AnimatedList";
import Button from "./ui/Button";
import LibraryRow from "./LibraryRow";

export type LibraryIndexProps = { posts: Post[]; tags: Tag[]; authors: Author[]; initial: LibraryFilters };

export default function LibraryIndex({ posts, tags, authors, initial }: LibraryIndexProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<LibraryFilters>(initial);
  const fuse = useMemo(() => makeLibraryFuse(posts), [posts]);

  // URL mirrors the filters (shareable; the /tag* and /author* redirects land
  // here with them set). replace, not push — typing must not grow history.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const qs = serializeLibraryParams(filters);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  const filtered = useMemo(() => applyLibraryFilters(posts, filters, fuse), [posts, filters, fuse]);
  const active = !!(filters.q || filters.tags.length || filters.author || filters.key);
  // A query orders by relevance, so the letter sections only exist when idle.
  const groups = useMemo(() => (filters.q ? [{ letter: "", posts: filtered }] : groupByLetter(filtered)), [filtered, filters.q]);
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
          <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-accent/65" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="search" value={filters.q} onChange={(e) => set({ ...filters, q: e.target.value })}
            // The ONE count on this surface (spec §18) lives in the placeholder.
            placeholder={`Buscar entre ${posts.length} canciones`}
            aria-label="Buscar canciones por título, artista o tonalidad"
            className="w-full bg-transparent py-3 pl-10 pr-3 font-label text-sm text-ink placeholder:text-placeholder focus:outline-none"
          />
        </div>
        {/* Task 4: <LibraryFilters filters={filters} onChange={set} tags={tags} authors={authors} keys={libraryKeys(posts)} /> */}
      </div>

      {active && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-ink-dim" aria-live="polite">{filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}</p>
          <Button variant="ghost" size="sm" onClick={clear}>Limpiar</Button>
        </div>
      )}

      <div className="relative">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-mono-400">
            <p className="font-label text-sm uppercase tracking-widest">No se encontraron canciones</p>
          </div>
        ) : (
          <div className={letters.length > 1 ? "pr-6" : ""}>
            {groups.map((g) => (
              <section key={g.letter || "resultados"} aria-label={g.letter ? `Letra ${g.letter}` : "Resultados"}>
                {g.letter && <h2 id={`letra-${g.letter}`} className="sticky top-[var(--navbar-h,5rem)] z-[1] bg-surface-base/90 py-1 font-display text-lg text-accent backdrop-blur-sm">{g.letter}</h2>}
                <AnimatedList as="ul" className="divide-y divide-ink-dim/[0.06]" items={g.posts.map((p) => ({ key: p._id, node: <LibraryRow post={p} /> }))} />
              </section>
            ))}
          </div>
        )}
        {letters.length > 1 && (
          <nav aria-label="Índice alfabético" className="sticky top-1/2 float-right -mr-1 flex -translate-y-1/2 flex-col items-center">
            {letters.map((l) => (
              <button key={l} type="button" onClick={() => jump(l)} className="px-1.5 py-px font-label text-[10px] text-ink-dim hover:text-accent focus:outline-none focus-visible:text-accent" aria-label={`Ir a la letra ${l}`}>{l}</button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
```

Ruling on the letter rail: the sticky heading offset uses `--navbar-h` if `brand.css` publishes one; if it does not, use `top-20 lg:top-24` (the navbar's fixed heights, `Navbar.tsx`). The rail lives on the right edge at every width (float + sticky, no JS measuring), and its buttons are plain `<button>`s by the same row exemption (tap targets in a rail).

- [ ] **Step 4: `loading.tsx`** — `SkeletonGroup label="Cargando la biblioteca"`: `NavbarSkeleton`, a `h-12` rounded-xl search bar, then eight rows: `flex gap-3 py-3` with a `w-10 h-10` key square, two text lines (`h-4 w-3/5`, `h-3 w-2/5`), and a `h-3 w-12` BPM.

- [ ] **Step 5: revalidate** — `revalidateSongViews()` becomes `/`, `/posts/[slug]` (page), `/biblioteca`. (`/tag*` becomes a redirect in Task 5; `/author*` was never revalidated — that gap closes with the route.)

- [ ] **Step 6: Component test** (`app/components/__tests__/libraryIndex.test.tsx`; mock `next/navigation` `useRouter`/`usePathname`, mock `@/app/context/PlayerContext` `usePlayer` → `{ openSheet: vi.fn() }`, wrap with the motion test setup used by `Presence.test.tsx`): renders letter headings A and B for two posts; typing `ala` in the search box narrows to one row and shows `1 resultado` + Limpiar; clicking a row calls `openSheet` with the post id; placeholder reads `Buscar entre 2 canciones`.

- [ ] **Step 7: Gates, commit** — `feat(library): /biblioteca — A–Z index of rows with a search console and letter rail`

---

### Task 4: Filter drawer

**Files:**
- Create: `app/components/LibraryFilters.tsx`
- Modify: `app/components/LibraryIndex.tsx` (render the drawer)
- Modify: `app/utils/__tests__/cueDialogMount.test.ts` (BASELINE 10 → 11)
- Create: `app/components/__tests__/libraryFilters.test.tsx`

**Interfaces:**
- Consumes: `LibraryFilters`, `TIPO_SLUGS`, `libraryKeys`, `CueDialog` (`open`, `mode="sheet"`, `size="md"`, `title`, `label`, `onDismiss`), `SegmentedControl` (`value | null`, `options`, `tone="filled"`), `Select` (`label`+`id`, sizes), `Button variant="pill" active`.

- [ ] **Step 1: Implement**

```tsx
"use client";
// app/components/LibraryFilters.tsx — the drawer (spec §12.2): Tipo as three
// segmented tiles, themes as chips sized by count, Artista and Tonalidad selects.
// Tipo and themes are all tags; the tiles just toggle their own slug in `tags`.
import { useMemo, useState } from "react";
import type { Tag, Author } from "@/app/utils/interface";
import { TIPO_SLUGS, type LibraryFilters as F } from "@/app/utils/libraryIndex";
import CueDialog from "./ui/CueDialog";
import SegmentedControl from "./ui/SegmentedControl";
import Select from "./ui/Select";
import Button from "./ui/Button";

type Tipo = (typeof TIPO_SLUGS)[number];
const TIPO_LABEL: Record<Tipo, string> = { "up-beat": "Up beat", "down-beat": "Down beat", transition: "Transición" };

export default function LibraryFilters({ filters, onChange, tags, authors, keys }: { filters: F; onChange: (f: F) => void; tags: Tag[]; authors: Author[]; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const tipo = (TIPO_SLUGS.find((s) => filters.tags.includes(s)) ?? null) as Tipo | null;
  const themes = useMemo(() => tags.filter((t) => !(TIPO_SLUGS as readonly string[]).includes(t.slug.current) && (t.postCount ?? 0) > 0), [tags]);
  const max = Math.max(1, ...themes.map((t) => t.postCount ?? 0));
  const count = filters.tags.length + (filters.author ? 1 : 0) + (filters.key ? 1 : 0);

  const toggleTag = (slug: string) => onChange({ ...filters, tags: filters.tags.includes(slug) ? filters.tags.filter((s) => s !== slug) : [...filters.tags, slug] });
  const setTipo = (next: Tipo) => onChange({ ...filters, tags: [...filters.tags.filter((s) => !(TIPO_SLUGS as readonly string[]).includes(s)), ...(tipo === next ? [] : [next])] });

  return (
    <>
      <Button variant="secondary" size="lg" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="shrink-0">
        Filtros{count > 0 ? ` · ${count}` : ""}
      </Button>
      <CueDialog open={open} mode="sheet" size="md" title="Filtros" label="Filtros" onDismiss={() => setOpen(false)}>
        <div className="space-y-6 p-5">
          <section>
            <p className="mb-2 font-label text-[11px] uppercase tracking-widest text-ink-dim">Tipo</p>
            <SegmentedControl label="Tipo de canción" tone="filled" value={tipo} onChange={setTipo}
              options={TIPO_SLUGS.map((s) => ({ value: s, label: TIPO_LABEL[s], badge: tags.find((t) => t.slug.current === s)?.postCount }))} />
          </section>
          <section>
            <p className="mb-2 font-label text-[11px] uppercase tracking-widest text-ink-dim">Temas</p>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t) => {
                const w = (t.postCount ?? 0) / max;           // chip size follows count (three steps)
                const size = w > 0.66 ? "text-sm px-3 py-1.5" : w > 0.33 ? "text-xs px-2.5 py-1" : "text-[11px] px-2 py-0.5";
                return <Button key={t._id} variant="pill" size="sm" active={filters.tags.includes(t.slug.current)} onClick={() => toggleTag(t.slug.current)} className={`normal-case tracking-normal ${size}`}>#{t.name} <span className="text-ink-dim">{t.postCount}</span></Button>;
              })}
            </div>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="filtro-artista" label="Artista" value={filters.author} onChange={(e) => onChange({ ...filters, author: e.target.value })}>
              <option value="">Todos</option>
              {authors.map((a) => <option key={a._id} value={a.slug.current}>{a.name}</option>)}
            </Select>
            <Select id="filtro-tonalidad" label="Tonalidad" value={filters.key} onChange={(e) => onChange({ ...filters, key: e.target.value })}>
              <option value="">Todas</option>
              {keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => onChange({ ...filters, tags: [], author: "", key: "" })}>Limpiar filtros</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Listo</Button>
          </div>
        </div>
      </CueDialog>
    </>
  );
}
```

Wire it: `LibraryIndex` imports `LibraryFilters` and renders it at the Task 3 comment, with `keys={libraryKeys(posts)}` memoised. `tags`/`authors` are unused by `LibraryIndex` until this task; if eslint flagged them in Task 3, they were prefixed `_` there — un-prefix now.

- [ ] **Step 2: Tests** — `libraryFilters.test.tsx`: opening the drawer shows the three Tipo options and the theme chips; choosing a Tipo calls `onChange` with that slug added and a previous Tipo removed; the Artista select lists authors; the count badge on the trigger reads `Filtros · 2` for two active filters. `cueDialogMount` BASELINE → 11 (one new `<CueDialog open={open}>` site).
- [ ] **Step 3: Gates, commit** — `feat(library): filter drawer — Tipo tiles, theme chips by count, artista and tonalidad`

---

### Task 5: Redirects, deletions, nav, label budget, home shrinks

**Files:**
- Modify: `next.config.mjs` (add `redirects()`)
- Delete: `app/(client)/tag/page.tsx`, `app/(client)/tag/[slug]/page.tsx`, `app/(client)/author/page.tsx`, `app/(client)/author/[slug]/page.tsx`, `app/components/TagSearchList.tsx`, `app/components/AuthorSearchList.tsx`, `app/components/SongSearchList.tsx`, `app/components/PostComponent.tsx`
- Modify: `app/(client)/page.tsx` (drop `POSTS_QUERY`, the Biblioteca heading, `SongSearchList`), `app/components/BottomNav.tsx` (`href: "/biblioteca"`, `match: (p) => /^\/(biblioteca|posts)/.test(p)`, drop the R1 comment), `app/components/NavLinks.tsx` (same), `app/components/__tests__/bottomNav.test.tsx`, `app/components/__tests__/navLinks.test.tsx`
- Modify: `app/utils/__tests__/labelBudget.test.ts` (`Índice musical` 0, `títulos` 0, add `"Repertorio": 0`), `app/utils/__tests__/lightContrast.test.ts` (drop the `SongSearchList` pin line), fixture via `node scripts/colour-inventory.mjs`
- Create: `scripts/__tests__/redirects.test.ts` (or `app/utils/__tests__/`), `docs/ROUTES.md` edits

- [ ] **Step 1: Redirects**

```js
// next.config.mjs — inside nextConfig
  // R1 (spec §12.2, decision H): the tag and author pages fold into the library.
  // permanent → 308; bookmarks and the old nav keep working, no data change.
  async redirects() {
    return [
      { source: "/tag",            destination: "/biblioteca",            permanent: true },
      { source: "/tag/:slug",      destination: "/biblioteca?tag=:slug",  permanent: true },
      { source: "/author",         destination: "/biblioteca",            permanent: true },
      { source: "/author/:slug",   destination: "/biblioteca?author=:slug", permanent: true },
    ];
  },
```

Test (`app/utils/__tests__/redirects.test.ts`): `import nextConfig from "../../../next.config.mjs"` (its coherence assert is a no-op without a git ref env — confirm by reading `scripts/lib/deployment-coherence.mjs`; if it throws under vitest, set the env it expects in the test or read the file as text and regex the four entries). Assert the four `{source, destination, permanent: true}` rows.

- [ ] **Step 2: Deletions and home** — remove the files above; in `page.tsx` delete `POSTS_QUERY`, the `posts` fetch (the `Promise.all` becomes a single `operationalClient.fetch`), the whole `Biblioteca` block and the `SongSearchList` import. `grep -rn "SongSearchList\|PostComponent\|TagSearchList\|AuthorSearchList" app docs` must return only history/docs to fix in Task 9. `worshipPageGate.test.ts` and `routeMatcher.test.ts` use `/tag` only as example paths — leave them.
- [ ] **Step 3: Nav + tests** — BottomNav/NavLinks hrefs and match; test expectations `/biblioteca`.
- [ ] **Step 4: Label budget + contrast pin** — edit as listed; run `node scripts/colour-inventory.mjs`; commit the fixture.
- [ ] **Step 5: ROUTES.md** — routes table: remove the four `/tag*`/`/author*` rows, add `/biblioteca` (S, ISR 60s fetch, dynamic by `searchParams`, guard `requireWorshipPage`), and a "Redirects" subsection listing the four 308s; fix the pre-existing mislabel: `/`, `/schedule`, `/posts/[slug]`, `/biblioteca` call `requireWorshipPage()` (ministry-scoped), so their Access column says **Worship** and the enforcement table gains a row.
- [ ] **Step 6: Gates, commit** — `feat(library): /tag* and /author* redirect into /biblioteca; the library leaves home`

---

### Task 6: DayCard becomes the run-sheet card

**Files:**
- Create: `app/utils/daysUntil.ts` (move from `NextServiceHero.tsx`; NextServiceHero imports it)
- Modify: `app/components/DayCard.tsx`, `app/components/PracticePlaylistButton.tsx`, `app/components/NextServiceHero.tsx`, `app/components/__tests__/daysUntil.test.ts` (import path), `app/utils/__tests__/labelBudget.test.ts` (`>Servicio<` → 0)
- Create: `app/components/__tests__/dayCard.test.tsx`

**Interfaces:**
- Consumes: `NumberRoll`, `Button`, `daysUntil`.
- Produces: `DayCardProps` gains `layout?: "card" | "wide"` (default `card`) and `hero?: boolean`; `PracticePlaylistButton` gains `variant?: "inline" | "hero"`; `formatCountdown(days)` exported from `app/utils/daysUntil.ts` (`"Hoy" | "Mañana" | "En N días"`). Task 7 consumes all three.

- [ ] **Step 1: `daysUntil.ts`** — move `daysUntil` verbatim (its comment included) and add:

```ts
export function formatCountdown(days: number): string {
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days < 0) return `Hace ${-days} día${days === -1 ? "" : "s"}`;
  return `En ${days} días`;
}
```
`NextServiceHero` imports both and drops its inline `countdownText` branch. `daysUntil.test.ts` imports from `../../utils/daysUntil` and gains three `formatCountdown` cases.

- [ ] **Step 2: Header remake** (§19.2 row 1, §18): replace the header block in `DayCard.tsx` (lines ~97-127):

```tsx
<div className={`${t.headerBg} border-b px-5 py-4 ${t.headerBorder}`}>
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <h3 className="font-display text-2xl font-bold uppercase leading-none text-ink md:text-3xl">
        {day}{shortDate && <span className={`${t.accentMuted} font-normal`}> · {shortDate}</span>}
      </h3>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {isNext && days !== null && (
        <span className="rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-1 font-label text-[10px] uppercase tracking-widest text-positive-fg">
          <NumberRoll value={formatCountdown(days)} />
        </span>
      )}
      {hero && hasSetlist && <PracticePlaylistButton variant="hero" songIds={setlist!.songs.map((s) => s._id)} accentVar={t.accentVar} />}
    </div>
  </div>
</div>
```
with `const days = date ? daysUntil(date) : null;`. The `SERVICIO` eyebrow, the long date and the `PRÓXIMO` pill go (the countdown replaces the pill on the next card; other cards show nothing — Task 7 collapses them anyway). `shortDate` keeps its `es-MX` `day numeric, month short` format. When `hero`, the inline `PracticePlaylistButton` in the Setlist row is not rendered (one Ensayar per card).

- [ ] **Step 3: Rows** — each setlist row gains BPM after the key: `{song.bpm && <span className="hidden w-10 text-right font-label text-[11px] text-mono-500 tabular-nums sm:inline">{song.bpm}</span>}` (both the single and the medley branches — extract the row into a local `SongRow` component to stop the duplication while touching it). The `Equipo` `h4` goes (label budget: `VOCES`/`INSTRUMENTOS`/`FRONT OF HOUSE` rails remain the section's only labels); the `Setlist` `h4` stays as the rail that holds `Editar`.

- [ ] **Step 4: `wide` layout** — when `layout === "wide"`, the body is `lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8` with the setlist section first and the team section second (the team section drops its `border-t pt-5` at `lg`); `card` keeps today's stacked layout.

- [ ] **Step 5: `PracticePlaylistButton` `variant="hero"`** — the trigger renders `<Button variant="primary" size="lg">▶ Ensayar</Button>` (the `▶` as an inline svg triangle, `aria-hidden`); the Menu of Música/Letras and all the pending/blocked/empty handling stay identical. `PracticePlaylistButton.test.tsx` gains one case: hero variant renders a primary button labelled "Ensayar" that opens the same menu.

- [ ] **Step 6: `dayCard.test.tsx`** (mock `usePlayer`, `useSession`, wrap with the motion test setup): header shows `DOMINGO · 13 sep` and no `Servicio` text; `isNext` with a date two days ahead of a fixed `now` shows `En 2 días` — pass `now` via a `Date` mock (`vi.setSystemTime`); `hero` renders the Ensayar primary button once and no inline practice button; a row with `bpm` shows it; `layout="wide"` puts the `lg:grid` class on the body.
- [ ] **Step 7: labelBudget `>Servicio<` → 0; gates; commit** — `feat(home): DayCard is the run-sheet card — day · date header, countdown, hero Ensayar, BPM column, wide layout`

---

### Task 7: Home composition — next service in full, the rest collapsed

**Files:**
- Create: `app/components/DayCardDisclosure.tsx`
- Modify: `app/(client)/page.tsx`, `app/(client)/loading.tsx`
- Create: `app/components/__tests__/dayCardDisclosure.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`DayCard layout="wide" hero`, `daysUntil`, `formatCountdown`), `Collapse`, `Button`.

- [ ] **Step 1: Disclosure**

```tsx
"use client";
// app/components/DayCardDisclosure.tsx — a non-next service collapsed to one
// line (spec §12.1): "SÁBADO 19 SEP · en 11 días ▾"; opening reveals the card.
import { useId, useState } from "react";
import { DayCard, type DayCardProps } from "./DayCard";
import Collapse from "./ui/Collapse";
import { daysUntil, formatCountdown } from "@/app/utils/daysUntil";

export default function DayCardDisclosure(props: DayCardProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const shortDate = props.date ? new Date(props.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "";
  const days = props.date ? daysUntil(props.date) : null;
  return (
    <div className="rounded-[var(--brand-radius-panel)] border border-ink-dim/15">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="font-display text-lg uppercase text-ink">{props.day}{shortDate && <span className="text-ink-dim"> · {shortDate}</span>}</span>
        <span className="flex items-center gap-3 font-label text-[11px] uppercase tracking-widest text-ink-dim">
          {days !== null && formatCountdown(days).toLowerCase()}
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>
      <Collapse open={open} id={id}><div className="px-2 pb-2"><DayCard {...props} /></div></Collapse>
    </div>
  );
}
```

- [ ] **Step 2: Page** — after computing `nextDate`, build one list `services: Array<{ key, props: DayCardProps }>` (specials, Saturday, Sunday — same props as today, `isNext` set by date); split into `next = services.find(isNext)` and `rest`. Render: the "Esta semana" heading (unchanged), then `<div data-lit {...revealProps(1)} className="brand-lit-card"><DayCard {...next.props} layout="wide" hero /></div>`, then `rest.map((s, i) => <DayCardDisclosure key … {...s.props} />)` in a `mt-4 space-y-3` column with `revealProps(2 + i)`. If nothing is next (all dates past) but cards exist, the first painting card is the hero. The empty state stays. `Navbar title="OWT" tags schedule` unchanged. Desktop: the hero spans the container (no `max-w-3xl` centring).
- [ ] **Step 3: `loading.tsx`** — one wide hero skeleton (header bar with a `h-7 w-40` title and a `h-10 w-28` rounded button, six rows, then two short rails) and two one-line disclosure skeletons (`h-14 rounded-xl`); label `Cargando servicios de la semana`.
- [ ] **Step 4: Test** — `dayCardDisclosure.test.tsx`: renders the one-line header with `SÁBADO · 19 sep` and the countdown; `aria-expanded` toggles on click and the `DayCard` content (a song title) is inside the `Collapse` region.
- [ ] **Step 5: Gates, commit** — `feat(home): the run sheet — next service in full, the rest collapsed to a line`

---

### Task 8: The lit card (§23, decision Q)

**Files:**
- Modify: `app/brand.css` (append ~30 lines; the "exactly four" beam comment becomes five), `app/utils/__tests__/__fixtures__/colour-inventory.json` (regenerated)
- Create: `app/utils/__tests__/litCard.test.ts`
- Modify: `docs/MOTION.md` (beam sites list)

- [ ] **Step 1: CSS**

```css
/* ── Lit card (spec §23, decision Q) — the FIFTH beam site. After the route
   reveal, the next service's card gets ONE light pass around its border,
   900 ms, then rests on its own accent border. A rotating conic pseudo-element
   under a border mask: transform only, no @property (Safari 16.4). Never loops;
   the global reduced-motion rule zeroes it. `data-lit` is set by the page. ── */
.brand-lit-card { position: relative; isolation: isolate; border-radius: var(--brand-radius-panel); }
.brand-lit-card[data-lit]::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0 78%, rgb(var(--accent-rgb) / 0.9) 92%, transparent 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
  opacity: 0;
  animation: brand-lit-pass 900ms var(--ease-in-out) 480ms 1 both;
}
@keyframes brand-lit-pass {
  0%   { opacity: 0; transform: rotate(-1turn); }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { opacity: 0; transform: none; }
}
```
The 480 ms delay lets the route reveal land first (spec: "after the route reveal"). The mask rotates the gradient *ring*, so `transform` on the pseudo-element is the whole effect. If the conic gradient needs a colour the inventory does not know, it is `rgb(var(--accent-rgb) / 0.9)` — a base role with alpha, allowed; regenerate the fixture.

- [ ] **Step 2: Guard** — `litCard.test.ts` reads `brand.css`: `.brand-lit-card[data-lit]::after` exists; `@keyframes brand-lit-pass` ends on `transform: none`; `animation-iteration-count` is `1` (the `1` in the shorthand); and reads `app/(client)/page.tsx`: `data-lit` appears exactly once. Also update the existing beam-count guard if `shellPolish`/another test enumerates beam sites (grep `beam` in `app/utils/__tests__`).
- [ ] **Step 3: Docs** — `docs/MOTION.md`: the beam sites list gains "5. the lit card on `/` (once, 900 ms)"; the §2.1 "exactly four" sentence is quoted there — update.
- [ ] **Step 4: `node scripts/colour-inventory.mjs`; gates; commit** — `feat(home): the lit card — one beam pass around the next service (decision Q)`

---

### Task 9: Documentation

**Files:**
- Modify: `docs/MOTION.md` (new "Library and run sheet (R1)" section under "Where the walk's findings landed": AnimatedList, the row pattern exemption, the label budget deltas, the lit card, redirects), `docs/UTILITIES_AND_COMPONENTS.md` (rows: `LibraryIndex`, `LibraryRow`, `LibraryFilters`, `DayCardDisclosure`, `AnimatedList`; remove `SongSearchList`, `TagSearchList`, `AuthorSearchList`, `PostComponent`; `DayCard` row updated), `docs/ROUTES.md` (verify Task 5's edits; `revalidateSongViews` paths), `CLAUDE.md` + `AGENTS.md` (reusable utils: `AnimatedList` after `NumberRoll`; `daysUntil`/`formatCountdown` — keep byte-identical, `agentDocsParity` guard), the spec: append **Part X — R1 (2026-09-10)** with scope, rulings (row exemption; redirects are 308; drawer carries Artista/Tonalidad because the author index is gone; long-press/pull-to-refresh stay R7; the `Setlist` rail stays as the home of `Editar`), deviations, and a "bundle: measured at release" placeholder.
- Grep `docs/` for `SongSearchList`, `/tag`, `PostComponent`, `Repertorio` and fix every live claim (history stays).
- [ ] Gates (docs guards: `agentDocsParity`, `labelBudget`); commit — `docs(motion): R1 — library route, run sheet, redirects, label budget`

---

### Task 10: Delivery (coordinator)

- [ ] Gates on the tip; bundle: cold build of `main` tip and of the R1 tip in THIS worktree (`scratchpad/measure-bundle.mjs` method), rows into the `docs/MOTION.md` ledger, Δ into Part X.
- [ ] Whole-branch code review on the most capable model → fix wave → scoped re-review → gates.
- [ ] Merge into `preview`, push, deploy-verifier (alias + SHA); dev-verify captures: `/` phone 390×844 (hero + collapsed lines + lit card at rest), `/biblioteca` phone (rows, rail) and 1440, the drawer open, `/tag/up-beat` redirect landing (`--route /tag/up-beat` must end on `/biblioteca?tag=up-beat`); before/after pairs under `docs/superpowers/specs/2026-09-08-premium-motion-shots/` (`home-before.png` from production at `0414ee86`, `home-after.png`, `biblioteca-before.png` = today's `/tag`, `biblioteca-after.png`) committed on the branch; visual-verifier pass.
- [ ] PR to `main` with the review trail; STOP for Frank's look.
