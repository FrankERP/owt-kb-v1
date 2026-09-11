import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

// Mirrors LibraryIndex: the search console, then eight 56 px rows (key dial,
// title + artist, BPM). Same container width as the real page, so the swap does
// not shift anything sideways.
export default function BibliotecaLoading() {
  return (
    <SkeletonGroup label="Cargando la biblioteca">
      <NavbarSkeleton />
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-8">
        <Skeleton className="mb-6 h-12 w-full" rounded="lg" />
        <div className="divide-y divide-ink-dim/[0.06]">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="h-10 w-10 shrink-0" rounded="lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
