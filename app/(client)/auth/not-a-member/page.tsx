"use client";

import Image from "next/image";
import { signOut } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";
import { blackout } from "@/app/components/ui/Blackout";
import Button from "@/app/components/ui/Button";
import { revealProps } from "@/app/utils/reveal";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";

export default function NotAMemberPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12 sm:py-16">
      <div className="w-full max-w-md md:max-w-[440px]" {...revealProps(0)}>
        {/* The same page head as the sign-in screen (ADR-0070): mark, title, lede. */}
        <div className="space-y-4 md:space-y-5">
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={88}
            height={88}
            className="brand-lockup-mark h-[72px] w-[72px] rounded-[20px] md:h-[88px] md:w-[88px] md:rounded-[24px]"
          />
          <h1 className={PAGE_TITLE}>Acceso no autorizado</h1>
          <p className={PAGE_LEDE}>Tu cuenta no está registrada como miembro del equipo.</p>
        </div>
        <div className="mt-9 space-y-6 md:mt-10">
          <p className="font-body text-[15px] leading-snug text-ink-dim">
            Pídele a un administrador que te agregue. Si entraste con la cuenta equivocada,
            cierra sesión e intenta con otra.
          </p>
        {/* Sign out first so the wrong account is cleared — a plain link back to
            sign-in would keep the current session and just loop back here. */}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
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
          Salir y entrar con otra cuenta
        </Button>
        </div>
      </div>
    </div>
  );
}
