import type { Config } from "tailwindcss";

const config: Config = {
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				display: ["var(--font-display)", "sans-serif"],
				body:    ["var(--font-body)",    "sans-serif"],
				label:   ["var(--font-label)",   "sans-serif"],
			},
			scrollSnapType: {
				x: "x mandatory",
			},
      boxShadow: {
        bottom: "0px 6px 4px -4px rgba(0, 0, 0, 0.1)",
      },
			scrollSnapAlign: {
				start: "start",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
export default config;
