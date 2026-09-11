import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

// The shape `/me` actually lands in (R3): the identity header, the next service as
// a full card, the rest as collapsed lines, the weekend list, the Ajustes card.
// A skeleton that still drew the old two-column tail would move everything on
// hydration, which is the one thing it exists to prevent.
export default function MeLoading() {
  return (
    <SkeletonGroup label="Cargando tu perfil">
      <NavbarSkeleton />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-12">
        {/* Identity header: avatar, name + alias + chips, then the one line. */}
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 shrink-0" rounded="full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-24 shrink-0" />
          </div>
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>

        {/* The next service in full… */}
        <div className="space-y-4">
          <div className="border border-surface-accent-faint rounded-xl overflow-hidden">
            <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="p-4 md:p-5 space-y-3">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="flex items-center gap-3 py-1">
                  <Skeleton className="w-4 h-3" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          </div>
          {/* …and the rest as collapsed lines. */}
          {[1, 2].map((j) => (
            <div key={j} className="rounded-[var(--brand-radius-panel)] border border-ink-dim/15 px-5 py-4 flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-20 shrink-0" />
            </div>
          ))}
        </div>

        {/* Availability: ten weekends, each with its two day toggles. */}
        <div className="rounded-2xl border border-surface-accent-20 p-5 space-y-3">
          <Skeleton className="h-5 w-36" />
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((j) => (
            <div key={j} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <div className="flex gap-2 shrink-0">
                <Skeleton className="h-9 w-16" rounded="full" />
                <Skeleton className="h-9 w-16" rounded="full" />
              </div>
            </div>
          ))}
        </div>

        {/* Ajustes. */}
        <Skeleton className="h-64" rounded="lg" />
      </div>
    </SkeletonGroup>
  );
}
