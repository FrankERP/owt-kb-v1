"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();

  if (!session?.user?.isImpersonating) return null;

  const impersonatedName = session.user.name ?? session.user.sanityId;
  const adminName = session.user.realAdminName ?? "Admin";

  async function stopImpersonating() {
    await update({ stopImpersonating: true });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-500/90 backdrop-blur-sm text-black flex items-center justify-center gap-3 px-4 py-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="font-label text-xs uppercase tracking-widest">
        Viendo como <strong>{impersonatedName}</strong> — sesión de prueba de {adminName}
      </span>
      <button
        onClick={stopImpersonating}
        className="ml-2 px-3 py-0.5 rounded-md border border-black/30 font-label text-xs uppercase tracking-widest hover:bg-black/10 transition-colors"
      >
        Salir
      </button>
    </div>
  );
}
