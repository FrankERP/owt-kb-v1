import React from "react";
import Link from "next/link";
import ThemeSwitch from "./ThemeSwitch";
import { Orbitron } from "next/font/google";

const font = Orbitron({ weight: "900", subsets: ["latin"] });

const Navbar = () => {
	return (
		<div className="mx-auto max-w-full px-6">
			<div className="flex justify-between items-center h-16 w-full">
				<Link href="/">
					<div className={`${font.className} text-5xl dark:text-[#C8D8EB]`}>
						Oasis Worship Team
					</div>
				</Link>
				<ThemeSwitch />
			</div>
		</div>
	);
};

export default Navbar;
