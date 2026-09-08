import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

export default function ScheduleLoading() {
  return (
    <SkeletonGroup label="Cargando el calendario" className="mx-auto max-w-7xl px-6 pt-10 mb-12">
      <NavbarSkeleton />
      <Skeleton className="h-8 w-64 mx-auto mb-6" />

      {/* Month navigation */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <Skeleton className="w-24 h-9" rounded="lg" />
        <Skeleton className="w-56 h-9" rounded="lg" />
        <Skeleton className="w-24 h-9" rounded="lg" />
      </div>

      {/* Month input pill */}
      <Skeleton className="h-9 w-40 mx-auto mb-4" rounded="lg" />

      {/* View toggle */}
      <Skeleton className="h-10 w-52 mx-auto mb-6" rounded="lg" />

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* One month block */}
      <div>
        <Skeleton className="h-5 w-40 mx-auto mb-4" />
        <div className="grid grid-cols-7 gap-1 mb-1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-3 w-8 mx-auto" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className="h-10" rounded="lg" />
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
