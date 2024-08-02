"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "./icons";

const ThemeSwitch = () => {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return null;
	}

	return (
		<button
			className="border rounded-full p-1 border-[#003572] border-opacity-20 hover:bg-[#003572] hover:bg-opacity-20  dark:hover:bg-[#C8D8EB] dark:hover:bg-opacity-20 dark:border-[#C8D8EB] dark:border-opacity-20"
			onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
		>
			{theme === "dark" ? <SunIcon /> : <MoonIcon />}
		</button>
	);
};

export default ThemeSwitch;
