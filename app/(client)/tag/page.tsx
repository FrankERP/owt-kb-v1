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
      <Navbar title="Tags" tags schedule />
      <TagSearchList tags={tags} totalSongs={totalSongs} />
    </div>
  );
};

export default page;
