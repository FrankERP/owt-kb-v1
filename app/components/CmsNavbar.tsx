import React from "react";
import Link from "next/link";
import { Orbitron } from "next/font/google";
import { HomeIconDark, HomeIconLight } from "./icons";
import exp from "constants";

const font = Orbitron({ weight: "900", subsets: ["latin"] });

const CmsNavbar = () => {
	return (
		<div className="mx-auto max-w-full px-6">
			<div className="flex justify-between items-center h-16 w-full">
				<Link href="/">
					<HomeIconLight />
				</Link>
				<Link href="/">
					<div className={`${font.className} text-5xl dark:text-[#C8D8EB]`}>
						Oasis Worship Team
					</div>
				</Link>
			</div>
		</div>
	);
};

export default CmsNavbar;
