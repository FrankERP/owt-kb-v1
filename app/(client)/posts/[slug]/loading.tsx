export default function PostLoading() {
  return (
    <div>
      {/* Navbar placeholder */}
      <div className="h-14 border-b border-surface-accent-20" />

      {/* Hero placeholder */}
      <div className="bg-surface-overlay border-b border-surface-accent-l100-d15">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-12 flex flex-col items-center text-center space-y-4">
          <div className="h-3 w-40 rounded bg-accent/20 animate-pulse" />
          <div className="h-10 w-2/3 max-w-xl rounded bg-ink-muted/15 animate-pulse" />
          <div className="h-4 w-32 rounded bg-ink-muted/10 animate-pulse" />
          <div className="flex gap-3 pt-4">
            <div className="h-7 w-14 rounded-full bg-accent/15 animate-pulse" />
            <div className="h-7 w-20 rounded-full bg-ink-muted/10 animate-pulse" />
            <div className="h-7 w-14 rounded-full bg-ink-muted/10 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Content placeholder */}
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <div className="h-6 w-32 mx-auto rounded bg-accent-deep/20 animate-pulse" />
        {[1, 2, 3, 4, 5].map((j) => (
          <div key={j} className="h-4 rounded bg-surface-accent-l15-d4 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
