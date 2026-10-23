import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../../components/ui/Skeleton";

// The song page's geometry (ADR-0070, Canción): a left-aligned title on the plain
// page, the authors' line, the 48 px ring pills, then a section heading over
// hairline rows — so the real page replaces the skeleton without a jump.
export default function PostLoading() {
  return (
    <SkeletonGroup label="Cargando la canción">
      <NavbarSkeleton />
      <div className="mx-auto flex max-w-7xl flex-col px-6 pb-10 pt-8 md:pb-12 md:pt-12">
        <Skeleton className="h-11 w-3/4 max-w-xl md:h-16" />
        <Skeleton className="mt-4 h-5 w-56" />
        <div className="mt-6 flex gap-2.5">
          <Skeleton className="h-12 w-16" rounded="full" />
          <Skeleton className="h-12 w-28" rounded="full" />
          <Skeleton className="h-12 w-16" rounded="full" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-3 px-6 pb-8 pt-10">
        <Skeleton className="mb-4 h-3 w-24" />
        {[1, 2, 3, 4].map((j) => (
          <Skeleton key={j} className="h-14 max-w-xl" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
