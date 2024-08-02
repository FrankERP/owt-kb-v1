import Link from "next/link";
import React from "react";
import { Post } from "../utils/interface";
import { Lilita_One, Orbitron, VT323, Josefin_Sans } from "next/font/google";

interface Props {
	post: Post;
}

const font = Josefin_Sans({ weight: "400", subsets: ["latin"] });
const date = VT323({ weight: "400", subsets: ["latin"] });

//@note Post card styling
const PostComponent = ({ post }: Props) => {
	return (
		<div className={cardStyle}>
			<Link href={`/posts/${post?.slug?.current}`}>
				<h2 className={`${font.className} text-2xl `}>{post?.title}</h2>
				<p
					className={`${date.className} my-2 text-gray-500`}
				>
					{new Date(post?.publishDate).toLocaleDateString("es-ES", {
						weekday: "long",
						year: "numeric",
						month: "long",
						day: "numeric",
					})}
				</p>
				<p className="mb-4 line-clamp-2 ">{post?.excerpt}</p>
			</Link>

      {/*Tags*/}

      <div>
        {post?.tags?.map((tag) => (
          <span key={tag?._id} className="mr-2 p-1 text-gray-500 rounded-sm lowercase dark:border-gray-900">
            #{tag?.name}
          </span>
        ))}
      </div>
		</div>
	);
};

export default PostComponent;

const cardStyle = `
  mb-8 
  p-4 
  border 
  border-gray-900
  rounded-md
  shadow-xl
  text-bold
  shadow-[#00bfff]
  hover:shadow-sm
  hover:bg-[#002249]
  hover:text-[#C8D8EB]
  hover:dark:bg-[#00bfff]
  hover:dark:text-[#002249]
`;
