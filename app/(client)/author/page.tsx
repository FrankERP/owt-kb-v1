import Navbar from "@/app/components/Navbar";
import AuthorSearchList from "@/app/components/AuthorSearchList";
import { Author } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getAuthorData(): Promise<{ authors: Author[]; totalSongs: number }> {
  // totalSongs is the distinct number of songs that have an author — NOT the sum
  // of per-author postCounts, which double-counts every multi-author song.
  const query = `{
    "authors": *[_type == "author"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && ^._id in authors[]._ref])
    },
    "totalSongs": count(*[_type == "post" && count(authors[]._ref) > 0])
  }`;
  return await client.fetch(query);
}

export const revalidate = 60;

const page = async () => {
  const { authors, totalSongs } = await getAuthorData();
  return (
    <div>
      <Navbar title="Artistas" tags schedule />
      <AuthorSearchList authors={authors} totalSongs={totalSongs} />
    </div>
  );
};

export default page;
