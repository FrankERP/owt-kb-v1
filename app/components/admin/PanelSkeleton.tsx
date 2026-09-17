// The `loading` component for every admin secondary tab loaded through
// `next/dynamic` (Task 6). Six rows are an arbitrary but honest placeholder —
// none of the five panels + `MonthGenerator` render fewer than a heading plus
// several list rows on first paint, so six shapes never over-promises less
// content than a slow chunk is about to deliver.
//
// `next/dynamic`'s `loading` also receives `DynamicOptionsLoadingProps`
// (`error`, `isLoading`, `retry`, …) on a genuine chunk-load failure — this is
// the one branch a bad network/CDN path can actually hit. `Button` for the
// retry, never a bare `<button>`.

import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import Button from "@/app/components/ui/Button";
import type { DynamicOptionsLoadingProps } from "next/dynamic";

export default function PanelSkeleton({ error, retry }: DynamicOptionsLoadingProps) {
  if (error) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="font-body text-sm text-mono-400">No se pudo cargar esta sección.</p>
        {retry && (
          <Button variant="ghost" onClick={retry}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }
  return (
    <SkeletonGroup label="Cargando…" className="space-y-3">
      {[...Array(6)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" rounded="lg" />
      ))}
    </SkeletonGroup>
  );
}
