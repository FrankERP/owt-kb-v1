import type { Metadata } from "next";
import Navbar from "@/app/components/Navbar";
import TagSearchList from "@/app/components/TagSearchList";
import { Tag } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

export const metadata: Metadata = {
  title: "Etiquetas — Oasis Worship Team",
  description: "Explora las canciones por etiqueta y tipo.",
};

async function getTagData(): Promise<{ tags: Tag[]; totalSongs: number }> {
  // totalSongs is the distinct catalog size — NOT the sum of per-tag postCounts,
  // which double-counts every song by how many tags it carries.
  const query = `{
    "tags": *[_type == "tag"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && ^._id in tags[]._ref])
    },
    "totalSongs": count(*[_type == "post"])
  }`;
  return await client.fetch(query);
}

export const revalidate = 60;

const page = async () => {
  const { tags, totalSongs } = await getTagData();

  return (
    <div>
      <Navbar title="Etiquetas" tags schedule />
      <header className="brand-song-hero">
        <div className="relative mx-auto max-w-7xl px-6 py-12 sm:py-16">
          <p className="font-label text-[10px] uppercase tracking-[0.26em] text-brand-beam">Explorar repertorio</p>
          <h1 className="mt-2 max-w-2xl font-display text-4xl font-semibold leading-none text-brand-frost sm:text-5xl">
            Mapa de etiquetas
          </h1>
          <p className="mt-4 max-w-xl font-body text-sm leading-relaxed text-brand-steel/70 sm:text-base">
            Encuentra canciones por energía, momento y función dentro del servicio.
          </p>
        </div>
      </header>
      <TagSearchList tags={tags} totalSongs={totalSongs} />
    </div>
  );
};

export default page;
