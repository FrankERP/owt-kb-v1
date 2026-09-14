"use client";

import { signOut } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";
import { blackout } from "@/app/components/ui/Blackout";

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        clearThemeMirror();
        const b = blackout();
        try {
          await b.done;
          await signOut({ callbackUrl: "/auth/signin" });
        } catch {
          b.cancel();
        }
      }}
      className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-negative-fg transition-colors"
    >
      Salir
    </button>
  );
}
