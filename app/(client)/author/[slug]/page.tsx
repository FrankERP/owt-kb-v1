import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import SongSearchList from "@/app/components/SongSearchList";
import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getPostsByAuthor(slug: string) {
  const query = `
    *[_type == "post" && references(*[_type == "author" && slug.current == $authorSlug]._id)] {
      _id, _createdAt, title, author, slug, publishDate, excerpt, timeSig, bpm, key,
      tags[] -> { _id, slug, name }
    }
  `;
  return await client.fetch(query, { authorSlug: slug });
}

async function getAuthorName(slug: string) {
  return client.fetch(`*[_type=="author" && slug.current==$slug][0].name`, { slug });
}

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = (await getAuthorName(slug)) ?? slug;
  return {
    title: `${name} — Oasis Worship Team`,
    description: `Canciones de ${name}.`,
  };
}

interface Params { params: Promise<{ slug: string }>; }

const page = async ({ params }: Params) => {
  const { slug } = await params;
  const [posts, name]: [Array<Post>, string | null] = await Promise.all([
    getPostsByAuthor(slug),
    getAuthorName(slug),
  ]);

  return (
    <div>
      <Navbar title={name ?? slug} tags schedule />
      <div className="relative overflow-hidden border-b border-[#003572]/15 dark:border-[#00bfff]/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-32 bg-[#00bfff]/10 rounded-full blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 py-10 flex flex-col items-center gap-2 text-center">
          <p className="font-display text-4xl sm:text-5xl text-[#00bfff] leading-none">{name ?? slug}</p>
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">
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
