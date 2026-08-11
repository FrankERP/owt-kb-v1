"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
      className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-negative-fg transition-colors"
    >
      Salir
    </button>
  );
}
