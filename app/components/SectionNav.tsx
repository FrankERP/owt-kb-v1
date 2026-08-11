"use client";

import { useState, useEffect } from "react";

interface Section {
  id: string;
  label: string;
}

export default function SectionNav({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id); },
        { rootMargin: "-25% 0px -65% 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [sections]);

  return (
    <div className="sticky top-14 lg:top-20 z-40 bg-surface-base/90 backdrop-blur-sm border-b border-edge-accent-subtle">
      <div className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={active === s.id ? "location" : undefined}
            className={`font-label text-xs uppercase tracking-widest px-4 py-3 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              active === s.id
                ? "border-accent text-accent"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-accent dark:hover:text-accent"
            }`}
          >
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}
