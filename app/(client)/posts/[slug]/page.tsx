import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";
import React from "react";
import {
	VT323,
	Special_Elite,
	Black_Ops_One,
	Russo_One,
	Urbanist,
	Jura,
	Advent_Pro,
} from "next/font/google";
import Link from "next/link";
import { PortableText } from "next-sanity";
import Image from "next/image";
import { urlFor } from "@/sanity/lib/image";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";

const date = VT323({ weight: "400", subsets: ["latin"] });
const titleFontqd = Special_Elite({ weight: "400", subsets: ["latin"] });
const titleFont2 = Black_Ops_One({ weight: "400", subsets: ["latin"] });
const titleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });
const subtitleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });

const bodyFont = Urbanist({ weight: "600", subsets: ["latin"] });
const tagFont = Jura({ weight: "600", subsets: ["latin"] });

interface Params {
	params: {
		slug: string;
	};
}

async function getPost(slug: string) {
	const query = `
    *[_type == "post" && slug.current == "${slug}"][0] {
      _id,
      title,
      author,
      slug,
      publishDate,
      excerpt,
      body,
      tags[] -> {
        _id,
        slug,
        name,
      },
      tutorials2[]{
        title,
        url
      },
      "lyricsURL": lyrics.asset->url,
      "chordsURL": chords.asset->url,
      "bothURL": bothPDF.asset->url,
      "ClickTrack": clickTrack.asset->url,
      "VoiceTrack": voiceTrack.asset->url,
  }`;
	const post = await client.fetch(query);
	return post;
}

export const revalidate = 60;

const Page = async ({ params }: Params) => {
	const post: Post = await getPost(params?.slug);

	if (!post) {
		notFound();
	}

	const pdfFiles = [
		{ url: post?.lyricsURL, title: "Lyrics PDF" },
		{ url: post?.chordsURL, title: "Chords PDF" },
		{ url: post?.bothURL, title: "Chords and Lyrics PDF" },
	].filter((pdf) => pdf.url);

	return (
		<div>
			<Navbar
				title={post?.title}
				author={post?.author}
			/>
			<div className="text-center">
				<span className={`${date.className}`}>
					{(() => {
						const formattedDate = new Date(
							post?.publishDate
						).toLocaleDateString("es-ES", {
							weekday: "long",
							year: "numeric",
							month: "long",
							day: "numeric",
						});
						return (
							formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)
						);
					})()}
				</span>
				<div className={`${tagFont.className} mt-5`}>
					{post?.tags?.map((tag) => (
						<Link
							key={tag?._id}
							href={`/tag/${tag?.slug?.current}`}
						>
							<span className="mr-2 p-1 text-gray-500 rounded-sm lowercase dark:border-gray-900">
								#{tag?.name}
							</span>
						</Link>
					))}
				</div>
				{/* Sección de Audio con Click*/}
				<div className="min-h-[10vw] overflow-x-auto max-w-[90vw]">
					<div className="flex space-x-4 justify-between">
					<div className="px-10 ml-10">
						<div className="">
							{post?.ClickTrack && (
								<div className="my-4 justify-center">
									<h3 className={`${bodyFont.className} text-lg font-bold`}>Escucha el track solo con el Click</h3>
									<audio controls>
										<source
											src={post.ClickTrack}
											type="audio/mp3"
										/>
										Tu navegador no soporta el elemento de audio.

									</audio>
								</div>
							)}
						</div>
						<div>
							{/* Botón de Descarga */}
							{post.ClickTrack && (
								<div className="my-4 border rounded-xl bg-[#003572] dark:bg-[#C8D8EB] hover:opacity-50">
									<a
										href={post.ClickTrack}
										download
										className={`${tagFont.className} text-[#C8D8EB] dark:text-[#003572] `}
									>
										Descargar audio
									</a>
								</div>
							)}
						</div>
					</div>
					<div className="px-5">
						<div className="">
							{post?.ClickTrack && (
								<div className="my-4 justify-center">
									<h3 className={`${bodyFont.className} text-lg font-bold`}>Escucha el track con la voz </h3>
									<audio controls>
										<source
											src={post.ClickTrack}
											type="audio/mp3"
										/>
										Tu navegador no soporta el elemento de audio.
									</audio>
								</div>
							)}
						</div>
						<div>
							{/* Botón de Descarga */}
							{post.ClickTrack && (
								<div className="my-4 border rounded-xl bg-[#003572] dark:bg-[#C8D8EB] hover:opacity-50">
									<a
										href={post.ClickTrack}
										download
										className={`${tagFont.className} text-[#C8D8EB] dark:text-[#003572] `}
									>
										Descargar audio
									</a>
								</div>
							)}
						</div>
					</div>
          </div>
				</div>
				<div className={richTextStyles}>
					<PortableText
						value={post?.body}
						components={myPortableTextComponents}
					/>
				</div>

				{/* Sección deslizable para los PDFs */}
				<div
					className={` mt-10 mb-4 mx-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`}
				>
					{pdfFiles.map((pdf, index) => (
						<div
							key={index}
							className={` w-full`}
						>
							<div
								className={`${subtitleFont.className} text-lg md:text-xl mb-2 md:mb-4`}
							>
								{pdf.title}
							</div>
							<iframe
								src={pdf.url}
								width="100%"
								height="500px" // Ajusta la altura según sea necesario
								className="border-0"
							></iframe>
						</div>
					))}
				</div>
				{/* Sección de Tutoriales en Youtube*/}

				<h2
					className={`${titleFont.className} uppercase font-extrabold text-2xl sm:text-3xl md:text-4xl lg:text-5xl mb-2`}
				>
					Tutorials
				</h2>
				<div className="mt-10 mb-4 overflow-x-auto">
					<div className="flex space-x-4 justify-between">
						{post.tutorials2.map((tutorial, index) => (
							<div
								key={index}
								className="flex-shrink-0 w-full max-w-xs"
							>
								<h3
									className={`${subtitleFont.className} text-lg md:text-xl font-bold mb-2`}
								>
									{tutorial.title}
								</h3>
								<iframe
									src={tutorial.url}
									width="100%"
									height="200px"
									className="border-0"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
									allowFullScreen
								></iframe>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Page;

const myPortableTextComponents = {
	types: {
		image: ({ value }: any) => (
			<Image
				src={urlFor(value).url()}
				alt="Post"
				width={700}
				height={700}
			/>
		),
	},
};

const richTextStyles = `
  ${bodyFont.className}
  mt-14
  text-justify
  max-w-2xl
  m-auto
  prose-headings:my-5
  prose-heading:text-2xl
  prose-p:mb-5
  prose-p:leading-7
`;
