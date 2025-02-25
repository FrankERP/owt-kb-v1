import Link from "next/link";
import React from "react";
import { Post } from "../utils/interface";
import { Lilita_One, Orbitron, VT323, Josefin_Sans, Russo_One, Advent_Pro, Urbanist, Jura } from "next/font/google";

interface Props {
	post: Post;
}

const font = Josefin_Sans({ weight: "400", subsets: ["latin"] });
const date = VT323({ weight: "400", subsets: ["latin"] });
const titleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });
const bodyFontLight = Urbanist({ weight: "400", subsets: ["latin"] });
const bodyFontDark = Urbanist({ weight: "800", subsets: ["latin"] });

const tagFont = Jura({ weight: "600", subsets: ["latin"] });





//@note Post card styling
const PostComponent = ({ post }: Props) => {
	return (
		<div className={cardStyle}>
			<Link href={`/posts/${post?.slug?.current}`}>
				<h2 className={`${titleFont.className} text-2xl `}>{post?.title} - {post?.author}</h2>
				<p
					className={`${date.className} my-2 text-gray-500`}
				>
					________________
				</p>
				<p className={`mb-4 line-clamp-2`}>
          <span className={`${bodyFontDark.className} text-gray-500`}>Time Sig: </span>
          <span className={`${bodyFontLight.className} text-black dark:text-white`}>{post?.timeSig}</span>  

          <span className={`${bodyFontDark.className} text-gray-500`}> -- BPM: </span>
          <span className={`${bodyFontLight.className} text-black dark:text-white`}>{post?.bpm}</span>

          <span className={`${bodyFontDark.className} text-gray-500`}> -- Original Key: </span>
          <span className={`${bodyFontLight.className} text-black dark:text-white`}>{post?.key}</span>
        </p>
			</Link>

      {/*Tags*/}

      <div>
        {post?.tags?.map((tag) => (
          <span key={tag?._id} className={`${date.className} text-xl mr-2 p-1 text-gray-500 rounded-sm lowercase dark:border-gray-900`}>
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
  
  shadow-[#00bfff]
  hover:shadow-md
  hover:bg-[#002249]
  hover:text-[#C8D8EB]
  hover:dark:bg-[#00bfff]
  hover:dark:text-[#002249]
`;


// const cardStyle = `
//   mb-8 
//   p-4 
//   border 
//   border-gray-900
//   rounded-md
//   shadow-xl
  
//   shadow-[#00bfff]
//   hover:shadow-5xl
//   hover:scale-105
// `;
