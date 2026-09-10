// Pure library logic (spec §12.2). NEUTRAL module — no React, no "use client" —
// so the /biblioteca Server Component and the client index share one truth.
// Search is the former SongSearchList's algorithm, moved here with ONE narrowing (see authorStartsWith below):
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

// A 1-2 char query against the raw author string false-positives on any word
// containing it mid-token (e.g. "an" inside "Redman") — narrow author matching
// to a per-word prefix so short queries stay precise; title keeps full substring
// matching since it's what's visually shown, sorted prefix-first below.
const authorStartsWith = (author: string, ql: string) =>
  normalizeText(author).split(/\s+/).some((w) => w.startsWith(ql));

export function searchPosts(posts: Post[], q: string, fuse: Fuse<Post> = makeLibraryFuse(posts)): Post[] {
  const raw = q.trim();
  if (!raw) return posts;
  const ql = normalizeText(raw);
  if (raw.length <= 2) {
    return posts
      .filter((p) => normalizeText(p.title).includes(ql) || authorStartsWith(p.author ?? "", ql) || normalizeText(p.key ?? "") === ql)
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
