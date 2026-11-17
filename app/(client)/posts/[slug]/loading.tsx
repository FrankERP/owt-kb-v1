import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../../components/ui/Skeleton";

// The song page's geometry (ADR-0070, Canción; the cover since ADR-0088 part 2): the
// album's cover (124 px over the title on a phone, 208 px beside it from `md`), a
// left-aligned title on the plain page, the authors' line, the 48 px ring pills, then a
// section heading over hairline rows — so the real page replaces the skeleton without a
// jump. All 148 songs have a cover, so the placeholder is drawn always.
export default function PostLoading() {
  return (
    <SkeletonGroup label="Cargando la canción">
      <NavbarSkeleton />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 pb-10 pt-8 md:flex-row md:items-end md:gap-10 md:pb-12 md:pt-12">
        <Skeleton className="h-[124px] w-[124px] shrink-0 md:h-[208px] md:w-[208px]" rounded="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Skeleton className="h-11 w-3/4 max-w-xl md:h-16" />
          <Skeleton className="mt-4 h-5 w-56" />
          <div className="mt-6 flex gap-2.5">
            <Skeleton className="h-12 w-16" rounded="full" />
            <Skeleton className="h-12 w-28" rounded="full" />
            <Skeleton className="h-12 w-16" rounded="full" />
          </div>
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
