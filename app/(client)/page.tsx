import Image from "next/image";
import { client } from "@/sanity/lib/client";
import Header from "../components/Header";
import { Post, featuredSongs } from "../utils/interface";
import PostComponent from "../components/PostComponent";
import Navbar from "../components/Navbar";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Advent_Pro } from "next/font/google";

const titleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });


async function getPosts() {
	const query = `
		*[_type == "post"] {
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
	}`;
	const data = await client.fetch(query);
	return data;
}

async function getWeekendSongs() {
  const currentWeek = new Date().toISOString().slice(0, 10); // Obtener la fecha de hoy en formato YYYY-MM-DD
	//console.log(currentWeek, 'currentWeek');
  const query = `
    *[_type == "featuredSongs" && week >= "${currentWeek}"] | order(week desc)[0] {
      songs[]-> {
        title,
        slug,
				_id,
      },
		week,
    }
  `;
  const weekendSongs = await client.fetch(query);
  return weekendSongs;
}


export const revalidate = 60;


export default async function Home() {
	const posts: Post[] = await getPosts();
	const songs:featuredSongs = await getWeekendSongs();
	//console.log(songs.week, 'week');

	//console.log(posts, 'posts');

	return (
		<div className="font-bold">
			<Navbar title="Songs" tags/>
			<div className="container mx-auto p-4">
				<h2 className={`${titleFont.className} flex justify-center text-2xl font-bold mb-4`} > Canciones {new Date(songs?.week).toLocaleDateString("es-ES", {
						weekday: "long",
						year: "numeric",
						month: "long",
						day: "numeric",
					})}</h2>
			</div>
			<div className="container text-center mb-5 mx-auto p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 shadow-bottom shadow-[#00bfff]">
        {songs.songs?.length > 0 &&
          songs.songs?.map((song) => (
            <Link key={song?._id} href={`/posts/${song.slug.current}`}>
              <div className="bg-white dark:bg-[#010b17] dark:border dark:border- dark:border-[#00bfff] shadow-md rounded-lg p-4 hover:bg-[#00bfff] hover:text-white transition-transform transform hover:scale-105">
                <h3 className={`${titleFont.className} text-lg capitalize`}>
                  {song.title}
                </h3>
              </div>
            </Link>
          ))}
      </div>
			<div className="container mx-auto p-4">
				<h2 className={`${titleFont.className} uppercase flex justify-center text-2xl font-bold mb-4`} > Todas las canciones</h2>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
				{posts?.length > 0 && posts?.map((post) => (
					<PostComponent key={post?._id} post={post} />
				))}
			</div>
		</div>
	);
}
