import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../../components/ui/Skeleton";

// The shape `/me/disponibilidad` lands in: the back link and heading, then the
// three month tiles of the grid's first page (one column on a phone, three from
// `sm` up — the same grid the real page draws, so nothing jumps on hydration).
export default function DisponibilidadLoading() {
  return (
    <SkeletonGroup label="Cargando tu disponibilidad">
      <NavbarSkeleton />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-8">
        {/* Back link, heading, eyebrow. */}
        <div className="space-y-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>

        {/* The actions above the grid, then the three months. */}
        <div className="space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40" rounded="full" />
            <Skeleton className="h-9 w-28" rounded="lg" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((m) => (
              <div key={m} className="rounded-xl border border-accent/15 p-3 space-y-2">
                <Skeleton className="h-3 w-24 mx-auto" />
                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-7" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonGroup>
  );
}
