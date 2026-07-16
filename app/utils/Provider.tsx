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
      <ThemeProvider attribute="class" forcedTheme="dark" enableSystem={false}>
        <PlayerProvider>{children}</PlayerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
};
