import Image from "next/image";
import { client } from "@/sanity/lib/client";
import Header from "../components/Header";
import { Post, SetListAndRoles } from "../utils/interface";
import PostComponent from "../components/PostComponent";
import SetlistPost from "../components/SetlistPost";
import Navbar from "../components/Navbar";
import { useEffect, useState } from "react";
import Link from "next/link";
import {Advent_Pro } from "next/font/google";
import { getSetlistAndRoles } from "@/sanity/lib/api";
import { set } from "sanity";




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
  const currentWeek = new Date().toISOString().slice(0, 10); // Get today in YYYY-MM-DD format
  console.log("Current week:", currentWeek); // Debugging

  const query = `
    *[_type == "featuredSongs" && week >= "${currentWeek}"] 
    | order(week desc)[0] {
      songs[]{
        song->{
          _id,
          title,
          slug,
          author,
          timeSig,
          bpm,
          key
        },
        play_key
      },
      week
    }
  `;

  const sundaySongs = await client.fetch(query);
  return sundaySongs;
}

function getCurrentWeekSunday() {
	const today = new Date();
	const currentDay = today.getDay();
	const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - currentDay + 7);
	return sunday.toLocaleDateString("es-ES", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export const revalidate = 60;


export default async function Home() {
	const posts: Post[] = await getPosts();
	const setListAndRoles: SetListAndRoles = await getSetlistAndRoles();
	console.log("Fetched songs:", setListAndRoles); // Debugging
	//console.log(songs.week, 'week');

	//console.log(posts, 'posts');

	return (
		<div className="font-bold">
			<Navbar title="Songs" tags />
			<div className="container mx-auto p-4">
				<h2 className={`${titleFont.className} flex justify-center text-2xl font-bold mb-4`} > Canciones del fin: {getCurrentWeekSunday()}</h2>
			</div>
			<div className="container text-center mb-5 mx-auto p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 shadow-bottom shadow-[#00bfff]">
			{setListAndRoles?.setlist ? (
					<SetlistPost key={setListAndRoles.setlist.week} setList={setListAndRoles} />
				) : (
					<p>No songs assigned for this week.</p>
				)}
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
