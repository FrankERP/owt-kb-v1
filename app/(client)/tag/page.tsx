import Navbar from "@/app/components/Navbar";
import TagSearchList from "@/app/components/TagSearchList";
import { Tag } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getAllTags() {
  const query = `
    *[_type == "tag"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && references("tags", ^._id)])
    }
  `;
  return await client.fetch(query);
}

export const revalidate = 60;

const page = async () => {
  const tags: Tag[] = await getAllTags();

  return (
    <div>
      <Navbar title="Tags" />
      <TagSearchList tags={tags} />
    </div>
  );
};

export default page;
