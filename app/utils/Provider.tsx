"use client"

import React from "react"
import { ThemeProvider } from "next-themes"
import { SessionProvider } from "next-auth/react"
import { PlayerProvider } from "@/app/context/PlayerContext"
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider"
import { ThemeBootstrap } from "@/app/components/ThemeBootstrap"

interface Props {
  children: React.ReactNode;
}

export const Provider = ({ children }: Props) => {
  return (
    <SessionProvider>
      {/*
        `defaultTheme="dark"` IS LOAD-BEARING AND MUST NOT BE DROPPED.
        next-themes computes `defaultTheme = enableSystem ? "system" : "light"`, so
        with enableSystem={false} and no explicit default, every member with no
        stored preference resolves to LIGHT the moment `forcedTheme` goes. That is
        the whole team, silently, with no control touched. Asserted as source text
        by providerTheme.test.ts, because a rendering test passes just as happily
        with forcedTheme still present.

        It landed one slice AHEAD of the forcedTheme removal on purpose: `forcedTheme`
        never reaches `resolvedTheme` (it only feeds the applier), so without an
        explicit default `resolvedTheme` reads "light" while the page paints dark —
        and ThemeBootstrap's theme-color swap would write light chrome onto a dark app.

        `forcedTheme` is gone as of Child E4. Rollback is re-adding it here: one
        line, instant, no data migration — `themePref` simply goes inert again.
      */}
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <ThemeBootstrap>
          <PlayerProvider>
            <CueDialogProvider>{children}</CueDialogProvider>
          </PlayerProvider>
        </ThemeBootstrap>
      </ThemeProvider>
    </SessionProvider>
  );
};
