import { Provider } from "../utils/Provider";
import CmsNavbar from "../components/CmsNavbar";
import { Orbitron } from "next/font/google";
import "./globals.css";

const titleFont = Orbitron({ weight: "900", subsets: ["latin"] });

export const metadata = {
	title: "OWT Content Studio",
	description: "Generated with Next.js",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body
				className={`${titleFont.className} h-full bg-[#C8D8EB] text-[#003572] dark:bg-[#010b17] dark:text-[#71c2dd] dark:selection:bg-teal-600`}
			>
				<Provider>
					<div className="pt-2 mt-10">
						<CmsNavbar/>
					</div>
					<main className="mx-auto max-w-full px-6">{children}</main>
				</Provider>
			</body>
		</html>
	);
}
