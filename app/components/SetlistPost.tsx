import Link from "next/link";
import React from "react";
import { SetListAndRoles } from "../utils/interface";
import { Advent_Pro, Urbanist, VT323, Jura } from "next/font/google";

interface Props {
	setList: SetListAndRoles; // This represents a week's setlist
}

const titleFont = Advent_Pro({ weight: "600", subsets: ["latin"] });
const bodyFontLight = Urbanist({ weight: "400", subsets: ["latin"] });
const ultraFontLight = Urbanist({ weight: "900", subsets: ["latin"] });

const bodyFontDark = Urbanist({ weight: "800", subsets: ["latin"] });
const tagFont = Jura({ weight: "600", subsets: ["latin"] });
const dateFont = VT323({ weight: "400", subsets: ["latin"] });

// 📝 Setlist Post Card Component
const SetListPost = ({ setList }: { setList: SetListAndRoles }) => {
	return (
		<div className="p-6 border rounded-lg shadow-lg">
			{/* Título con la Fecha */}
			<h2 className="text-2xl font-bold text-center mb-4">
				Setlist{" "}
				{new Date(`${setList.setlist.week}T00:00:00Z`).toLocaleDateString(
					"es-ES",
					{
						weekday: "long",
						year: "numeric",
						month: "long",
						day: "numeric",
						timeZone: "UTC",
					}
				)}
			</h2>

			{/* Canciones */}
			<h3 className="text-xl font-semibold mb-2">🎵 Songs</h3>
			<ul className="mb-6">
				{setList.setlist.songs.map(({ song, play_key }) => (
					<li
						key={song._id}
						className="border-b py-2 flex justify-between items-center space-x-2 py-2"
					>
						<Link
							href={`/posts/${song.slug.current}`}
							className="text-[#003572] dark:text-gray-500 hover:underline"
						>
							{song.title} - {song.author}
						</Link>
						<span className="text-[#00bfff]">[{play_key}]</span>
					</li>
				))}
			</ul>

			{/* Roles */}
			<h3 className={`${ultraFontLight.className} text-xl mb-2`}>🎤 Team Members</h3>

			{setList.roles && Object.keys(setList.roles).length > 0 ? (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{Object.entries(setList.roles)
						.filter(([key]) => key !== "week") // Exclude the date
						.map(([role, members]) => (
							<div
								key={role}
								className={`p-4 border rounded-lg shadow-m`}
							>
								<h4 className={`${ultraFontLight.className}`}>{role}</h4>
								<ul className={`${bodyFontLight.className} text-[#27aad6]`}>
									{Array.isArray(members) ? (
										members.map((member: any, index: number) => (
											<li key={index}>
												{member?.alias || "Unknown Member"}
											</li>
										))
									) : (
										<li>{members?.alias || "Unknown Member"}</li>
									)}
								</ul>
							</div>
						))}
				</div>
			) : (
				<p className="text-gray-500 italic">
					❌ No roles assigned for this Sunday.
				</p>
			)}
		</div>
	);
};

export default SetListPost;

// 🔥 Styling
const cardStyle = `
  mb-8 
  p-4 
  border 
  border-gray-900
  rounded-md
  shadow-xl
  shadow-[#00bfff]
  
`;
