import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

// Mirrors LibraryIndex: the search console, the shelf of new songs (a heading over a row
// of square covers, ADR-0088 part 2), then eight 72 px rows (cover, title + artist, the key
// over the BPM on the right). Same container width as the real page, so the swap does not
// shift anything sideways.
export default function BibliotecaLoading() {
  return (
    <SkeletonGroup label="Cargando la biblioteca">
      <NavbarSkeleton />
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-8">
        <Skeleton className="mb-6 h-12 w-full" rounded="lg" />
        <Skeleton className="mb-4 h-3 w-36" />
        <div className="-mx-6 mb-6 flex gap-3.5 overflow-hidden px-6">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="w-[132px] shrink-0 space-y-2.5 md:w-[156px]">
              <Skeleton className="aspect-square w-full" rounded="lg" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
        <div className="divide-y divide-ink-dim/[0.06]">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex min-h-[72px] items-center gap-3.5 px-2 py-2.5">
              <Skeleton className="h-[52px] w-[52px] shrink-0" rounded="lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-6 w-10 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
