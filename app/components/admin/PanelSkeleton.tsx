// The `loading` component for every admin secondary tab loaded through
// `next/dynamic` (Task 6). Six rows are an arbitrary but honest placeholder —
// none of the five panels + `MonthGenerator` render fewer than a heading plus
// several list rows on first paint, so six shapes never over-promises less
// content than a slow chunk is about to deliver.
//
// A SUSPENSE FALLBACK AND NOTHING ELSE. In the App Router `next/dynamic` renders
// this with `{ isLoading: true, pastDelay: true, error: null }` and never passes
// an `error` or a `retry` (`next/dist/shared/lib/lazy-dynamic/loadable.js`), so
// a failure branch here would be dead code that reads like a safety net. A
// rejected chunk throws through `React.lazy` instead, and `PanelBoundary` is
// what catches it and offers «Reintentar».

import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";

export default function PanelSkeleton() {
  return (
    <SkeletonGroup label="Cargando…" className="space-y-3">
      {[...Array(6)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" rounded="lg" />
      ))}
    </SkeletonGroup>
  );
}
