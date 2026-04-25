"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
      className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-red-400 transition-colors"
    >
      Salir
    </button>
  );
}
