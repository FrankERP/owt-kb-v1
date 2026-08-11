export default function MeLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 mb-12 space-y-8">
      {/* Hero countdown skeleton */}
      <div className="space-y-3">
        <div className="h-4 w-32 rounded bg-accent-deep/20 animate-pulse" />
        <div className="h-10 w-56 rounded bg-accent-deep/20 animate-pulse" />
      </div>

      {/* DayCard skeleton */}
      <div className="border border-surface-accent-faint rounded-xl overflow-hidden">
        <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
          <div className="h-7 w-32 rounded bg-accent-deep/30 animate-pulse" />
          <div className="h-4 w-44 rounded bg-accent-deep/20 animate-pulse" />
        </div>
        <div className="p-4 md:p-5 space-y-3">
          {[1, 2, 3, 4].map((j) => (
            <div key={j} className="flex items-center gap-3 py-1">
              <div className="w-4 h-3 rounded bg-accent-deep/15 animate-pulse" />
              <div className="h-4 flex-1 rounded bg-accent-deep/15 animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Profile + availability skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-48 rounded-xl bg-surface-accent-l10-d4 animate-pulse" />
        <div className="h-48 rounded-xl bg-surface-accent-l10-d4 animate-pulse" />
      </div>
    </div>
  );
}
