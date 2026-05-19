export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 mb-12">
      <div className="h-8 w-40 mx-auto rounded-lg bg-[#003572]/20 animate-pulse mb-6" />

      {/* DayCard skeletons */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="border border-[#003572]/20 dark:border-[#00bfff]/10 rounded-xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-[#003572]/20 dark:bg-[#001f3f]/60 px-5 py-4 border-b border-[#003572]/10 space-y-2">
              <div className="h-7 w-28 rounded bg-[#003572]/30 animate-pulse" />
              <div className="h-4 w-44 rounded bg-[#003572]/20 animate-pulse" />
            </div>
            {/* Body */}
            <div className="p-4 md:p-5 space-y-3">
              <div className="h-3 w-14 rounded bg-[#003572]/20 animate-pulse" />
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="flex items-center gap-3 py-1">
                  <div className="w-4 h-3 rounded bg-[#003572]/15 animate-pulse" />
                  <div className="h-4 flex-1 rounded bg-[#003572]/15 animate-pulse" style={{ width: `${60 + (j * 7) % 30}%` }} />
                  <div className="h-4 w-8 rounded bg-[#003572]/15 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
