import React from "react";
import Link from "next/link";
import { Orbitron } from "next/font/google";
import { HomeIconDark, HomeIconLight } from "./icons";
import exp from "constants";
import Image from "next/image";
import Header from "./Header";
import ThemeSwitch from "./ThemeSwitch";

const font = Orbitron({ weight: "900", subsets: ["latin"] });

const CmsNavbar = () => {
	return (
		<div className="mx-auto max-w-full px-6 mb-10 mt-5">
			<div className="grid grid-cols-4 mt-4 justify-items-center ">
				<Link className="basis-1/4 justify-self-start self-center" href="/">
					{/*<div className={`${font.className} text-5xl dark:text-[#C8D8EB]`}>
						Oasis Worship Team
					</div> */}
					<Image src="/LogoOasis.png" alt="Oasis Worship Team" width={100} height= {100} className={`${font.className}`}></Image>
				</Link>
				<div className="mx-20 self-center basis-1/2 col-start-2 col-span-2 pt-10 text-sm" >
				<div className={`${font.className} text-2xl`}>
						Content Studio
					</div>
				</div>
				<div className="basis-1/4 justify-self-end col-start-4 self-center pb-10">
					<ThemeSwitch />
				</div>
			</div>
		</div>
	);
};

export default CmsNavbar;
