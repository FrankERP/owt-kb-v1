"use client"

import React from "react"
import { ThemeProvider } from "next-themes"
import { SessionProvider } from "next-auth/react"
import { PlayerProvider } from "@/app/context/PlayerContext"

interface Props {
  children: React.ReactNode;
}

export const Provider = ({ children }: Props) => {
  return (
    <SessionProvider>
      {/* Force dark as the default and ignore the OS `prefers-color-scheme`.
          Light mode is kept intact — the ThemeSwitch toggle still works. */}
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <PlayerProvider>{children}</PlayerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
};
