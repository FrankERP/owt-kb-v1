import type { Metadata } from "next";
import { Provider } from "../utils/Provider";
import CmsNavbar from "../components/CmsNavbar";
import "./globals.css";
import "../brand.css";
import { bodyFont, displayFont, labelFont } from "../brandFonts";

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
		<html
			lang="es"
			suppressHydrationWarning
			className={`${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`}
		>
			<body
				className="brand-atmosphere min-h-screen bg-brand-blackout font-body text-brand-frost selection:bg-brand-beam/35"
			>
				<Provider>
					<div className="pt-2">
						<CmsNavbar/>
					</div>
					<main className="mx-auto max-w-full px-6">{children}</main>
				</Provider>
			</body>
		</html>
	);
}
