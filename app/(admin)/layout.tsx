import type { Metadata } from "next";
import { Provider } from "../utils/Provider";
import CmsNavbar from "../components/CmsNavbar";
import { Orbitron } from "next/font/google";
import "./globals.css";

const titleFont = Orbitron({ weight: "900", subsets: ["latin"] });

export const metadata: Metadata = {
	title: "OWT Content Studio",
	description: "Panel de administración del equipo de alabanza Oasis.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="es" suppressHydrationWarning>
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
