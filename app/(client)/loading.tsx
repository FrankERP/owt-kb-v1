import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../components/ui/Skeleton";

export default function HomeLoading() {
  return (
    <SkeletonGroup label="Cargando servicios de la semana">
      <NavbarSkeleton />
      <div className="mx-auto mb-16 max-w-7xl px-6 pt-12">
        <Skeleton className="h-8 w-40 mx-auto mb-6" rounded="lg" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="border border-surface-accent-faint rounded-xl overflow-hidden">
              <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-4 w-44" />
              </div>
              <div className="p-4 md:p-5 space-y-3">
                <Skeleton className="h-3 w-14" />
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="flex items-center gap-3 py-1">
                    <Skeleton className="w-4 h-3" />
                    <Skeleton className="h-4 flex-1" style={{ width: `${60 + (j * 7) % 30}%` }} />
                    <Skeleton className="h-4 w-8" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
