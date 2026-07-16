import { Advent_Pro, Jura, Urbanist } from "next/font/google";

export const displayFont = Advent_Pro({
  weight: "600",
  subsets: ["latin"],
  variable: "--font-display",
});

export const bodyFont = Urbanist({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-body",
});

export const labelFont = Jura({
  weight: "600",
  subsets: ["latin"],
  variable: "--font-label",
});
