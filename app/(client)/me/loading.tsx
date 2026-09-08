import Skeleton, { SkeletonGroup } from "../../components/ui/Skeleton";

export default function MeLoading() {
  return (
    <SkeletonGroup label="Cargando tu perfil" className="mx-auto max-w-7xl px-6 pt-10 mb-12 space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-56" />
      </div>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-48" rounded="lg" />
        <Skeleton className="h-48" rounded="lg" />
      </div>
    </SkeletonGroup>
  );
}
