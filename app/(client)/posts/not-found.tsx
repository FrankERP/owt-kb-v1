import Link from "next/link";

// Shown when a song slug doesn't resolve (posts/[slug] calls notFound()).
// On-brand, Spanish fallback matching the client error boundary.
export default function SongNotFound() {
  return (
    <div className="min-h-[70svh] flex flex-col items-center justify-center gap-6 px-6 text-center">
      <svg
        width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className="text-accent/70" aria-hidden
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>

      <div className="space-y-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Canción no encontrada</h1>
        <p className="font-body text-sm text-mono-400 max-w-sm mx-auto">
          Esta canción no existe o su enlace cambió. Puede que haya sido movida o eliminada.
        </p>
      </div>

      <Link
        href="/"
        className="font-label text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg bg-surface-accent-solid hover:bg-accent-deep/80 dark:hover:bg-accent/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        Ver todas las canciones
      </Link>
    </div>
  );
}
