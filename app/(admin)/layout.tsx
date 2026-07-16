import type { Metadata } from "next";
import { Provider } from "../utils/Provider";
import CmsNavbar from "../components/CmsNavbar";
import { Orbitron } from "next/font/google";
import "./globals.css";

const titleFont = Orbitron({ weight: "900", subsets: ["latin"] });

export const metadata: Metadata = {
	title: "OWT Content Studio",
	applicationName: "Backstage",
	description: "Panel de administración del equipo de alabanza Oasis.",
	manifest: "/manifest.webmanifest",
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "any" },
			{ url: "/icons/backstage-v2-32.png", type: "image/png", sizes: "32x32" },
			{ url: "/icons/backstage-v2-192.png", type: "image/png", sizes: "192x192" },
			{ url: "/icons/backstage-v2-512.png", type: "image/png", sizes: "512x512" },
		],
		shortcut: [{ url: "/icons/backstage-v2-32.png", type: "image/png", sizes: "32x32" }],
		apple: [{ url: "/icons/backstage-v2-180.png", type: "image/png", sizes: "180x180" }],
	},
	appleWebApp: {
		capable: true,
		title: "Backstage",
		statusBarStyle: "black-translucent",
	},
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
