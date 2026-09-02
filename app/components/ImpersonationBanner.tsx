"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const BANNER_CLASS = "impersonating";
/** Read by `.impersonating .brand-navbar` in brand.css. */
const BANNER_H_VAR = "--impersonation-h";

export default function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const active = !!session?.user?.isImpersonating;

  // Both this banner and the navbar are `sticky top-0`, in different
  // containers, so they occupied the same strip and the banner's higher
  // z-index covered the top of the navbar. The navbar cannot know the banner
  // exists — it renders inside <main>, and whether the banner shows is decided
  // from the session here — so the offset is published on the root element
  // instead, the same channel the theme uses.
  //
  // The height is MEASURED, not hard-coded. A constant was ~9px short at
  // desktop width and far shorter than the truth on a phone, where this
  // sentence wraps to two or three lines.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.classList.remove(BANNER_CLASS);
      root.style.removeProperty(BANNER_H_VAR);
    };
    if (!active) {
      clear();
      return;
    }
    root.classList.add(BANNER_CLASS);
    const bar = barRef.current;
    const publish = () => {
      const h = barRef.current?.offsetHeight;
      if (h) root.style.setProperty(BANNER_H_VAR, `${h}px`);
    };
    publish();
    // Guarded: jsdom has no ResizeObserver, and the CSS fallback covers it.
    const ro = typeof ResizeObserver !== "undefined" && bar ? new ResizeObserver(publish) : null;
    if (ro && bar) ro.observe(bar);
    window.addEventListener("resize", publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", publish);
      clear();
    };
  }, [active]);

  if (!active) return null;

  const impersonatedName = session.user.name ?? session.user.sanityId;
  const adminName = session.user.realAdminName ?? "Admin";

  /**
   * Leaving an impersonated session is a mutation, and it used to navigate
   * whether or not it worked: `update()` was awaited, never checked, and any
   * rejection escaped. A refused stop then dropped the admin on /admin still
   * impersonating, with the banner as the only clue that the button had done
   * nothing.
   *
   * A NULLISH result is the failure signal, not a rejection. NextAuth v4's
   * `fetchData` catches every error — network, non-2xx, bad JSON — and returns
   * `null`; `update()` itself returns `undefined` while the session is still
   * loading. It never rejects, so checking only `next.user.isImpersonating`
   * reads every real-world failure as success. The catch stays for safety, but
   * it is not the path that fires.
   */
  async function stopImpersonating() {
    setLeaving(true);
    setError(null);
    try {
      const next = await update({ stopImpersonating: true });
      if (!next || next.user?.isImpersonating) {
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
    <div ref={barRef} className="sticky top-0 z-[60] w-full bg-warning-fg/90 backdrop-blur-sm text-surface-base flex items-center justify-center gap-3 px-4 py-2">
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
