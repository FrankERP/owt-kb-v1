"use client";

import { signOut } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";

export function SignOutButton() {
  return (
    <button
      onClick={() => { clearThemeMirror(); signOut({ callbackUrl: "/auth/signin" }); }}
      className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-negative-fg transition-colors"
    >
      Salir
    </button>
  );
}
