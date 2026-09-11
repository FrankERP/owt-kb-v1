import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

// Mirrors the R2 shell: the month header row, the week strip, the Agenda|Mes toggle
// and the agenda's first rows — the AGENDA, because that is the mode the route opens
// in. The seven strip cells keep the `grid-cols-7` the calendar's month grid also
// uses (pinned by loadingSkeletons.test.ts).
export default function ScheduleLoading() {
  return (
    <SkeletonGroup label="Cargando el calendario">
      <NavbarSkeleton />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16">
        {/* Month header: ‹ SEPTIEMBRE 2026 › */}
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="h-9 w-9 shrink-0" rounded="lg" />
          <div className="flex flex-1 justify-center">
            <Skeleton className="h-7 w-40" />
          </div>
          <Skeleton className="h-9 w-9 shrink-0" rounded="lg" />
        </div>

        {/* Jump-to-month field */}
        <div className="mb-6 flex justify-center">
          <Skeleton className="h-9 w-40" rounded="lg" />
        </div>

        {/* Week strip */}
        <div className="mb-6 grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-14" rounded="lg" />
          ))}
        </div>

        {/* Agenda | Mes */}
        <div className="mb-6 flex justify-center">
          <Skeleton className="h-10 w-40" rounded="lg" />
        </div>

        {/* Agenda rows */}
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16" rounded="lg" />
          ))}
        </div>
      </div>
    </SkeletonGroup>
  );
}
