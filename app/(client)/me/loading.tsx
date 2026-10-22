import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../../components/ui/Skeleton";

// The shape `/me` actually lands in (R3, F3; «Tu cuenta» 2026-10-22): the
// identity header, the next service as a full card, the rest as collapsed lines,
// and the «Tu cuenta» list (eyebrow, then a card of icon rows). No Ajustes block — the settings card is `/me/ajustes`,
// which has its own skeleton.
// A skeleton that still drew the old two-column tail would move everything on
// hydration, which is the one thing it exists to prevent.
export default function MeLoading() {
  return (
    <SkeletonGroup label="Cargando tu perfil">
      <NavbarSkeleton />
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-16 space-y-12">
        {/* Identity header: avatar, name + alias + chips, then the one line. */}
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 shrink-0" rounded="full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-24 shrink-0" />
          </div>
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>

        {/* The next service in full… */}
        <div className="space-y-4">
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
          {/* …and the rest as collapsed lines. */}
          {[1, 2].map((j) => (
            <div key={j} className="rounded-[var(--brand-radius-panel)] border border-ink-dim/15 px-5 py-4 flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-20 shrink-0" />
            </div>
          ))}
        </div>

        {/* «Tu cuenta»: the eyebrow, then a card of rows — icon square, title
            over a status line, chevron. Three rows: what every member gets
            (Disponibilidad, Ajustes) plus one calendar row; the real list has
            up to four, and a row short beats a card the member never gets. */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 ml-1" />
          <div className="rounded-2xl border border-edge-accent-subtle divide-y divide-ink/[0.06]">
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex items-center gap-3.5 px-4 py-3.5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-[10px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <Skeleton className="h-4 w-4 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonGroup>
  );
}
