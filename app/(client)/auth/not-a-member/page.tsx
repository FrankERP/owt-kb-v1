"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";

export default function NotAMemberPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <Image src="/LogoOasis.png" alt="Oasis Worship Team" width={56} height={56} className="mx-auto" />
        <h1 className="font-display text-xl uppercase tracking-wide">Acceso no autorizado</h1>
        <p className="font-body text-sm text-gray-400">
          Tu cuenta no está registrada como miembro del equipo. Contacta a un
          administrador para que te agreguen, o si iniciaste sesión con la cuenta
          equivocada, cierra sesión e intenta con otra.
        </p>
        {/* Sign out first so the wrong account is cleared — a plain link back to
            sign-in would keep the current session and just loop back here. */}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="inline-block font-label text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60"
        >
          Cerrar sesión e intentar con otra cuenta
        </button>
      </div>
    </div>
  );
}
