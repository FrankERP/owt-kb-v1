"use client"

import React from "react"
import { ThemeProvider } from "next-themes"
import { SessionProvider } from "next-auth/react"

interface Props {
  children: React.ReactNode;
}

export const Provider = ({ children }: Props) => {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class">{children}</ThemeProvider>
    </SessionProvider>
  );
};
