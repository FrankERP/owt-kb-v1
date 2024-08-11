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
			scrollSnapType: {
				x: "x mandatory",
			},
      boxShadow: {
        'bottom': '0px 6px 4px -4px rgba(0, 0, 0, 0.1)', // Ajusta los valores según lo necesites
      },
			scrollSnapAlign: {
				start: "start",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
export default config;
