import Header from "@/app/components/Header";
import Navbar from "@/app/components/Navbar";
import { Tag } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import Link from "next/link";
import React from "react";

async function getAllTags() {
	const query = `
    *[_type == "tag"] {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && references("tags", ^._id)])
    }
    `;
	const tags = client.fetch(query);
	return tags;
}

export const revalidate = 60;

const page = async () => {
	const tags: Tag[] = await getAllTags();
	console.log(tags, "tags");

	return <div>
    
    <Header title= 'Tags'/>
    {/*@todo REFERENCE: this is what I have to do with the youtube links*/}
    <div>
      {tags?.length >0 && tags?.map((tag) => (
        <Link key={tag?._id} href={`/tag/${tag.slug.current}`}> 
          <div className="p-2 text-md lowercase dark:bg-[#010b17] border-b dark:border-gray-800 hover:text-[#00bfff]">
            #{tag.name} ({tag?.postCount})
          </div>

        </Link>
      ))}
    </div>
  </div>;
};

export default page;