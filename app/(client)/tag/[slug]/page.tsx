import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import SongSearchList from "@/app/components/SongSearchList";
import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getPostsByTag(tag: string) {
  const query = `
    *[_type == "post" && references(*[_type == "tag" && slug.current == $tagSlug]._id)] {
      _id,
      _createdAt,
      title,
      author,
      slug,
      publishDate,
      excerpt,
      timeSig,
      bpm,
      key,
      tags[] -> {
        _id,
        slug,
        name,
      }
    }
  `;
  return await client.fetch(query, { tagSlug: tag });
}

async function getTagName(slug: string) {
  return client.fetch<string | null>(`*[_type=="tag" && slug.current==$slug][0].name`, { slug });
}

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = (await getTagName(slug)) ?? slug;
  return {
    title: `#${name} — Oasis Worship Team`,
    description: `Canciones etiquetadas como ${name}.`,
  };
}

interface Params {
  params: Promise<{ slug: string }>;
}

const page = async ({ params }: Params) => {
  const { slug } = await params;
  const [posts, name]: [Array<Post>, string | null] = await Promise.all([
    getPostsByTag(slug),
    getTagName(slug),
  ]);
  const displayName = name ?? slug;

  return (
    <div>
      <Navbar title={`#${displayName}`} tags schedule />

      {/* Tag hero */}
      <div className="brand-song-hero">
        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-3 px-6 py-12 text-center sm:py-16">
          <p className="font-label text-[10px] uppercase tracking-[0.26em] text-brand-steel/60">Colección</p>
          <p className="font-display text-4xl capitalize leading-none text-brand-beam sm:text-6xl">
            #{displayName}
          </p>
          <p className="rounded-full border border-brand-steel/15 bg-brand-blackout/30 px-3 py-1.5 font-label text-[10px] uppercase tracking-widest text-brand-steel/65">
            {posts.length} {posts.length === 1 ? "canción" : "canciones"}
          </p>
        </div>
      </div>

      <div className="pt-8">
        <SongSearchList posts={posts} />
      </div>
    </div>
  );
};

export default page;
