"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";
import { blackout } from "@/app/components/ui/Blackout";
import Button from "@/app/components/ui/Button";
import { revealProps } from "@/app/utils/reveal";

export default function NotAMemberPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6" {...revealProps(0)}>
        <Image src="/LogoOasis.png" alt="Oasis Worship Team" width={56} height={56} className="mx-auto" />
        <h1 className="font-display text-xl uppercase tracking-wide">Acceso no autorizado</h1>
        <p className="font-body text-sm text-mono-400">
          Tu cuenta no está registrada como miembro del equipo. Contacta a un
          administrador para que te agreguen, o si iniciaste sesión con la cuenta
          equivocada, cierra sesión e intenta con otra.
        </p>
        {/* Sign out first so the wrong account is cleared — a plain link back to
            sign-in would keep the current session and just loop back here. */}
        <Button
          variant="primary"
          size="lg"
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
        >
          Cerrar sesión e intentar con otra cuenta
        </Button>
      </div>
    </div>
  );
}
