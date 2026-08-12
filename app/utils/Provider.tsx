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
        `defaultTheme="system"` + `enableSystem={true}` — ONE change, not two.

        These two must move together, in both directions. next-themes resolves a
        "system" theme only when enableSystem is true: `applyTheme` is
        `i === "system" && n && (c = x())`, so with `n` false the resolution never
        runs and the applier strips light/dark and adds a literal `system` class,
        leaving the document with NO theme class at all — no error, nothing logged,
        all 94 dark: utilities off at once. Parent §9 names this exactly.

        THE DEFAULT LIVES IN THREE PLACES and they must agree, because useTheme()
        exposes no defaultTheme to share: here, ThemeBootstrap's unset-with-a-mirror
        repair, and THEME_MIGRATION_SCRIPT's catch in themePref.ts. Miss the second
        and the legacy-mirror cohort stays pinned to dark against the new default,
        invisibly, with the suite green. Guarded by themeWiring.test.ts.

        ROLLBACK IS ORDERED — see the Child F plan. Move the three defaults back to
        "dark" but LEAVE enableSystem true: stored "system" values are still out
        there in members' localStorage mirrors, and flipping the flag back while
        they exist puts every one of those members in the class-less document. If
        the flag must also go back, a client-side mirror reconciliation has to ship
        and reach the team first.
      */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem={true}>
        <ThemeBootstrap>
          <PlayerProvider>
            <CueDialogProvider>{children}</CueDialogProvider>
          </PlayerProvider>
        </ThemeBootstrap>
      </ThemeProvider>
    </SessionProvider>
  );
};
