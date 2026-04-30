"use client";

import { useState } from "react";

interface Chart {
  key: string;
  content: string;
}

export default function ChordChart({ charts }: { charts: Chart[] }) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (!charts.length) return null;

  const current = charts[activeIdx];

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Key tabs — only show when there are multiple charts */}
      {charts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {charts.map((c, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`font-label text-xs uppercase tracking-widest px-4 py-1.5 rounded-full border transition-colors ${
                i === activeIdx
                  ? "border-[#00bfff] bg-[#00bfff]/15 text-[#00bfff]"
                  : "border-[#003572]/25 dark:border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff]/50 hover:text-[#00bfff]"
              }`}
            >
              {c.key || `Tonalidad ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Single key badge when there's only one */}
      {charts.length === 1 && current.key && (
        <span className="font-label text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border border-[#00bfff]/40 text-[#00bfff] inline-block">
          {current.key}
        </span>
      )}

      {/* Chart content */}
      <pre className="font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words rounded-xl border border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5 px-5 py-5 overflow-x-auto">
        {current.content}
      </pre>
    </div>
  );
}
