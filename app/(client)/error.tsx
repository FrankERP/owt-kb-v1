"use client";

// Error boundary for the client route group. Without this, a failed request-
// time data fetch (e.g. a Sanity/network hiccup) would drop the user on
// Next.js's unstyled default error page with no way back. Renders an on-brand,
// Spanish fallback with a retry action and a link home.

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[client] page error:", error);
  }, [error]);

  return (
    <div className="min-h-[70svh] flex flex-col items-center justify-center gap-6 px-6 text-center">
      <svg
        width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className="text-[#00bfff]/70" aria-hidden
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <div className="space-y-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Algo salió mal</h1>
        <p className="font-body text-sm text-gray-400 max-w-sm mx-auto">
          No pudimos cargar esta página. Puede ser un problema temporal de conexión —
          intenta de nuevo.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="font-label text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00bfff]/60"
        >
          Reintentar
        </button>
        <Link
          href="/"
          className="font-label text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/25 text-gray-400 hover:text-[#00bfff] hover:border-[#00bfff]/40 transition-colors"
        >
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
