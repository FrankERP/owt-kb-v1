import type { Metadata } from "next";
import { Inter, Fira_Code, Josefin_Sans, Gabarito } from "next/font/google";
import "./globals.css";
import Navbar from "../components/Navbar";
import { Provider } from "../utils/Provider";

const inter = Inter({ subsets: ["latin"] });
const firaCode = Fira_Code({ subsets: ["latin"] });
const textFont = Josefin_Sans({ weight: "600", subsets: ["latin"] });
const titleFont = Gabarito({ weight: "600", subsets: ["latin"] });

export const metadata: Metadata = {
	title: "Oasis Worship Team Knowledge Base",
	description: "Generated by create next app",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body
				className={`${titleFont.className} h-full bg-[#C8D8EB] text-[#003572] dark:bg-[#010b17] dark:text-[#C8D8EB] dark:selection:bg-teal-600 font-bold`}
			>
				<Provider>
					<main className="mx-auto max-w-full px-6">{children}</main>
				</Provider>
			</body>
		</html>
	);
}
