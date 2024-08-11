import Header from "@/app/components/Header";
import Navbar from "@/app/components/Navbar";
import { Tag } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import { Urbanist } from "next/font/google";
import Link from "next/link";
import React from "react";

async function getAllTags() {
  const query = `
    *[_type == "tag"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && references("tags", ^._id)])
    }
  `;
  const tags = await client.fetch(query); // Asegúrate de que la consulta se resuelva antes de continuar
  return tags;
}

const tagFont = Urbanist({ weight: "600", subsets: ["latin"] });

export const revalidate = 60;

const page = async () => {
  const tags: Tag[] = await getAllTags();
  console.log(tags, "tags");

  return (
    <div>
      <Navbar title="Tags" />
      <div className="container mx-auto p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {tags?.length > 0 &&
          tags?.map((tag) => (
            <Link key={tag?._id} href={`/tag/${tag.slug.current}`}>
              <div className="bg-white dark:bg-[#010b17] dark:border dark:border- dark:border-[#00bfff] shadow-md rounded-lg p-4 hover:bg-[#00bfff] hover:text-white transition-transform transform hover:scale-105">
                <h3 className={`${tagFont.className} text-lg capitalize`}>
                  #{tag.name}
                </h3>
                <p className="text-sm text-gray-500">
                  {tag?.postCount} post{tag?.postCount !== 1 && 's'}
                </p>
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
};

export default page;
