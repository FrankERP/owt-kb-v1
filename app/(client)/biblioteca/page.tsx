import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import LibraryIndex from "@/app/components/LibraryIndex";
import { client } from "@/sanity/lib/client";
import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { parseLibraryParams, serializeLibraryParams } from "@/app/utils/libraryIndex";
import type { Post, Tag, Author } from "@/app/utils/interface";

export const metadata: Metadata = {
  title: "Biblioteca — Oasis Worship Team",
  description: "Todas las canciones, por título, artista, tonalidad y tema.",
};

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

// `searchParams` makes the page dynamic per request; `revalidate = 60` still
// governs the fetch cache (`client.fetch` honours it). The GROQ result does not
// depend on the params — filtering is client-side — so one cached result serves
// every param value.
export default async function BibliotecaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorshipPage("/biblioteca");
  const sp = await searchParams;
  const data = await client.fetch<{ posts: Post[]; tags: Tag[]; authors: Author[] }>(QUERY);
  // `parseLibraryParams` lives in a NEUTRAL module (no "use client"), so this
  // Server Component may CALL it — see ADR-0028.
  const initial = parseLibraryParams(sp);
  return (
    <div>
      <Navbar title="Biblioteca" tags schedule />
      {/* `key` forces a fresh MOUNT on a real navigation to a new `?q=`/`?tag=`
          (the /tag*, /author* redirects land here with params set). The index
          now mirrors ITS OWN state into the URL with `history.replaceState`,
          which never re-renders this Server Component — so without a `key`,
          navigating from one param set to another would find the index still
          holding the FIRST navigation's filters, since `initial` only seeds
          state on mount. Typing never changes `sp`/`key` (`replaceState` is
          not a navigation), so it never remounts the index mid-keystroke. */}
      <LibraryIndex
        key={serializeLibraryParams(initial)}
        posts={data.posts ?? []}
        tags={data.tags ?? []}
        authors={data.authors ?? []}
        initial={initial}
      />
    </div>
  );
}
