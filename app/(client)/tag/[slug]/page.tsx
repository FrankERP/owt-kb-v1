import Navbar from "@/app/components/Navbar";
import SongSearchList from "@/app/components/SongSearchList";
import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getPostsByTag(tag: string) {
  const query = `
    *[_type == "post" && references(*[_type == "tag" && slug.current == "${tag}"]._id)] {
      _id,
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
  return await client.fetch(query);
}

export const revalidate = 60;

interface Params {
  params: Promise<{ slug: string }>;
}

const page = async ({ params }: Params) => {
  const { slug } = await params;
  const posts: Array<Post> = await getPostsByTag(slug);

  return (
    <div>
      <Navbar title={`#${slug}`} tags schedule />
      <div className="pt-10">
        <SongSearchList posts={posts} />
      </div>
    </div>
  );
};

export default page;
