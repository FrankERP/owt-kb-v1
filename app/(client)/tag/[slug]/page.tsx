import Header from "@/app/components/Header";
import Navbar from "@/app/components/Navbar";
import PostComponent from "@/app/components/PostComponent";
import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import React from "react";

async function getPostsByTag(tag: string) {
	const query = `
    *[_type == "post" && references(*[_type == "tag" && slug.current == "${tag}"]._id)] {
			_id,
			title,
			author,
			slug,
			publishDate,
			excerpt,
			tags[] -> {
				_id,
				slug,
				name,
			}
	}
  `;

	const posts = await client.fetch(query);
	return posts;
}

export const revalidate = 60;

interface Params {
	params: {
		slug: string;
	};
}

const page = async ({ params }: Params) => {
	const posts: Array<Post> = await getPostsByTag(params.slug);
	console.log(posts[0]?.tags[1]?.name, "posts by tag 2");

	return (
		<div>
			<Navbar title={`#${params.slug}`} tags />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
        {posts?.length > 0 && posts?.map((post) => (
          <PostComponent key = {post?._id} post = {post}/>
        ))}
      </div>
		</div>
	);
};

export default page;
