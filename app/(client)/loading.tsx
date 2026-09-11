import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../components/ui/Skeleton";

// Mirrors the run sheet (spec §12.1): one wide hero card — header bar with the
// day and the Ensayar button, six song rows, then the Voces/Instrumentos rails —
// followed by the two collapsed services as single lines. Same container as the
// real page, so the swap does not shift anything sideways.
export default function HomeLoading() {
  return (
    <SkeletonGroup label="Cargando servicios de la semana">
      <NavbarSkeleton />
      <div className="mx-auto mb-16 max-w-7xl px-6 pt-12">
        <Skeleton className="mb-7 h-9 w-56" rounded="lg" />
        <div className="overflow-hidden rounded-xl border border-surface-accent-faint">
          <div className="flex items-center justify-between gap-4 border-b border-accent-deep/10 bg-surface-accent-l20-d60-sunken px-5 py-4">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-10 w-28" rounded="lg" />
          </div>
          <div className="space-y-3 p-5 md:p-6">
            {[1, 2, 3, 4, 5, 6].map((j) => (
              <div key={j} className="flex items-center gap-3 py-1">
                <Skeleton className="h-3 w-4" />
                <Skeleton className="h-4 flex-1" style={{ width: `${60 + (j * 7) % 30}%` }} />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
            <div className="space-y-2 pt-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 w-full" rounded="lg" />
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
