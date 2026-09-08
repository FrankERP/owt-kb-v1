"use client";

// Error boundary for the client route group. Without this, a failed request-
// time data fetch (e.g. a Sanity/network hiccup) would drop the user on
// Next.js's unstyled default error page with no way back. Renders an on-brand,
// Spanish fallback with a retry action and a link home.

import { useEffect } from "react";
import Button from "../components/ui/Button";

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
        className="text-accent/70" aria-hidden
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <div className="space-y-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Algo salió mal</h1>
        <p className="font-body text-sm text-mono-400 max-w-sm mx-auto">
          No pudimos cargar esta página. Puede ser un problema temporal de conexión —
          intenta de nuevo.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={reset}>
          Reintentar
        </Button>
        <Button href="/">Ir al inicio</Button>
      </div>
    </div>
  );
}
