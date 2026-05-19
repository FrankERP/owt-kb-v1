export default function PostLoading() {
  return (
    <div>
      {/* Navbar placeholder */}
      <div className="h-14 border-b border-[#003572]/20 dark:border-[#00bfff]/15" />

      {/* Hero placeholder */}
      <div className="bg-[#001f3f] dark:bg-[#00162e] border-b border-[#003572] dark:border-[#00bfff]/15">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-12 flex flex-col items-center text-center space-y-4">
          <div className="h-3 w-40 rounded bg-[#00bfff]/20 animate-pulse" />
          <div className="h-10 w-2/3 max-w-xl rounded bg-[#C8D8EB]/15 animate-pulse" />
          <div className="h-4 w-32 rounded bg-[#C8D8EB]/10 animate-pulse" />
          <div className="flex gap-3 pt-4">
            <div className="h-7 w-14 rounded-full bg-[#00bfff]/15 animate-pulse" />
            <div className="h-7 w-20 rounded-full bg-[#C8D8EB]/10 animate-pulse" />
            <div className="h-7 w-14 rounded-full bg-[#C8D8EB]/10 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Content placeholder */}
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <div className="h-6 w-32 mx-auto rounded bg-[#003572]/20 animate-pulse" />
        {[1, 2, 3, 4, 5].map((j) => (
          <div key={j} className="h-4 rounded bg-[#003572]/15 dark:bg-[#00bfff]/[0.04] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
