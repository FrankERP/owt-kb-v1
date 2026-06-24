import Navbar from "@/app/components/Navbar";
import AuthorSearchList from "@/app/components/AuthorSearchList";
import { Author } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getAllAuthors() {
  const query = `
    *[_type == "author"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && ^._id in authors[]._ref])
    }
  `;
  return await client.fetch(query);
}

export const revalidate = 60;

const page = async () => {
  const authors: Author[] = await getAllAuthors();
  return (
    <div>
      <Navbar title="Artistas" tags schedule />
      <AuthorSearchList authors={authors} />
    </div>
  );
};

export default page;
