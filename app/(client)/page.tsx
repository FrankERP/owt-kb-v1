import Image from "next/image";
import { client } from "@/sanity/lib/client";
import Header from "../components/Header";
import { Post } from "../utils/interface";
import PostComponent from "../components/PostComponent";
import Navbar from "../components/Navbar";

async function getPosts() {
	const query = `
		*[_type == "post"] {
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
	}`;
	const data = await client.fetch(query);
	return data;
}


export const revalidate = 60;


export default async function Home() {
	const posts: Post[] = await getPosts();
	//console.log(posts, 'posts');

	return (
		<div className="font-bold">
			<Navbar title="Songs" tags/>
			<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
				{posts?.length > 0 && posts?.map((post) => (
					<PostComponent key={post?._id} post={post} />
				))}
			</div>
		</div>
	);
}
