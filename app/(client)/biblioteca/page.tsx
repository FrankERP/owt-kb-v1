import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import LibraryIndex from "@/app/components/LibraryIndex";
import { client } from "@/sanity/lib/client";
import { requireWorshipPage } from "@/app/utils/worshipPageGate";
import { parseLibraryParams } from "@/app/utils/libraryIndex";
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
  return (
    <div>
      <Navbar title="Biblioteca" tags schedule />
      {/* `parseLibraryParams` lives in a NEUTRAL module (no "use client"), so this
          Server Component may CALL it — see ADR-0028. */}
      <LibraryIndex
        posts={data.posts ?? []}
        tags={data.tags ?? []}
        authors={data.authors ?? []}
        initial={parseLibraryParams(sp)}
      />
    </div>
  );
}
