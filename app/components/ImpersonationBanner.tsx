"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/** Height of the banner; the navbar's sticky offset in brand.css must match. */
const BANNER_CLASS = "impersonating";

export default function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !!session?.user?.isImpersonating;

  // Both this banner and the navbar are `sticky top-0`, in different
  // containers, so they occupied the same 32px and the banner's higher z-index
  // covered the top of the navbar. The navbar cannot know the banner exists —
  // it renders inside <main>, and whether the banner shows is decided from the
  // session here — so the offset is published on the root element instead, the
  // same channel the theme uses.
  useEffect(() => {
    const root = document.documentElement;
    if (active) root.classList.add(BANNER_CLASS);
    else root.classList.remove(BANNER_CLASS);
    return () => root.classList.remove(BANNER_CLASS);
  }, [active]);

  if (!active) return null;

  const impersonatedName = session.user.name ?? session.user.sanityId;
  const adminName = session.user.realAdminName ?? "Admin";

  /**
   * Leaving an impersonated session is a mutation, and it used to navigate
   * whether or not it worked: `update()` was awaited, never checked, and any
   * rejection escaped. A refused stop then dropped the admin on /admin still
   * impersonating, with the banner as the only clue that the button had done
   * nothing. Confirm from the session that came back, and stay put otherwise.
   */
  async function stopImpersonating() {
    setLeaving(true);
    setError(null);
    try {
      const next = await update({ stopImpersonating: true });
      if (next?.user?.isImpersonating) {
        setError("No se pudo salir. Intenta de nuevo.");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("No se pudo salir. Intenta de nuevo.");
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="sticky top-0 z-[60] w-full bg-warning-fg/90 backdrop-blur-sm text-surface-base flex items-center justify-center gap-3 px-4 py-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="font-label text-xs uppercase tracking-widest">
        {error
          ? error
          : <>Viendo como <strong>{impersonatedName}</strong> — sesión de prueba de {adminName}</>}
      </span>
      <button
        type="button"
        onClick={stopImpersonating}
        disabled={leaving}
        className="ml-2 px-3 py-0.5 rounded-md border border-scrim/30 font-label text-xs uppercase tracking-widest hover:bg-scrim/10 transition-colors disabled:opacity-60"
      >
        {leaving ? "Saliendo…" : "Salir"}
      </button>
    </div>
  );
}
