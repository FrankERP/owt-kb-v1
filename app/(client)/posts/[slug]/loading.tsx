import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../../components/ui/Skeleton";

export default function PostLoading() {
  return (
    <SkeletonGroup label="Cargando la canción">
      <NavbarSkeleton />
      <div className="bg-surface-overlay border-b border-surface-accent-l100-d15">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-12 flex flex-col items-center text-center space-y-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10 w-2/3 max-w-xl" />
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-3 pt-4">
            <Skeleton className="h-7 w-14" rounded="full" />
            <Skeleton className="h-7 w-20" rounded="full" />
            <Skeleton className="h-7 w-14" rounded="full" />
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <Skeleton className="h-6 w-32 mx-auto" />
        {[1, 2, 3, 4, 5].map((j) => (
          <Skeleton key={j} className="h-4" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
