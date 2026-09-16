"use client";

import { useState, useEffect } from "react";
import SlidingIndicator, { useActiveIntoView } from "./ui/SlidingIndicator";
import Presence from "./ui/Presence";
import PracticeCluster, { type PracticeInfo } from "./song/PracticeCluster";

export type { PracticeInfo };

interface Section {
  id: string;
  label: string;
}

function Item({ id, label, active }: { id: string; label: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <a
      ref={ref}
      href={`#${id}`}
      aria-current={active ? "location" : undefined}
      className={`relative font-label text-xs uppercase tracking-widest px-4 py-3 transition-colors whitespace-nowrap shrink-0 ${
        active ? "text-accent" : "text-mono-500 dark:text-mono-400 hover:text-accent dark:hover:text-accent"
      }`}
    >
      {label}
      {active && <SlidingIndicator id="section-nav" variant="underline" />}
    </a>
  );
}

export default function SectionNav({ sections, practice }: { sections: Section[]; practice?: PracticeInfo }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  // The bar picks up the hero's practice controls exactly when the hero stops
  // carrying them (R4, ruling 1) — one observer on `#song-hero`, threshold 0.
  const [heroGone, setHeroGone] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("song-hero");
    if (!hero) return;
    const obs = new IntersectionObserver(
      ([entry]) => setHeroGone(!entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(hero);
    return () => obs.disconnect();
  }, []);

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
    <div className="sticky top-[calc(5rem+env(safe-area-inset-top))] lg:top-[calc(6rem+env(safe-area-inset-top))] z-40 bg-surface-base/90 backdrop-blur-sm border-b border-edge-accent-subtle">
      <div className="max-w-7xl mx-auto px-6 flex items-center">
        <div className="flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {sections.map((s) => (
            <Item key={s.id} id={s.id} label={s.label} active={active === s.id} />
          ))}
        </div>
        {/* Always rendered, so the bar's height never changes when the cluster
            fades in — motion must not shift the layout under a reader's thumb. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-3 min-h-[44px]">
          <Presence show={heroGone && !!practice} variant="fade" as="div" className="flex items-center gap-2">
            {practice && <PracticeCluster {...practice} />}
          </Presence>
        </div>
      </div>
    </div>
  );
}
