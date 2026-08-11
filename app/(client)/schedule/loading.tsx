export default function ScheduleLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 mb-12 space-y-6">
      <div className="h-8 w-48 rounded-lg bg-accent-deep/20 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="border border-surface-accent-faint rounded-xl overflow-hidden"
          >
            <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
              <div className="h-6 w-24 rounded bg-accent-deep/30 animate-pulse" />
              <div className="h-3 w-36 rounded bg-accent-deep/20 animate-pulse" />
            </div>
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((j) => (
                <div key={j} className="h-3 rounded bg-accent-deep/15 animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
