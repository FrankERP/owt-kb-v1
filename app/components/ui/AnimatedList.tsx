"use client";
// app/components/ui/AnimatedList.tsx
// The one list-reflow primitive (spec §12.2, §5.1): filtered rows slide to their
// new place (`layout`), leavers fade in --motion-fast, newcomers fade in. Under
// `domMax` (already loaded) `layout` is available; before the feature chunk
// arrives the list simply renders static. `initial={false}` keeps first paint
// still — no 142 rows flying in. The host stays a real <ul>/<ol> for semantics.
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { MS, EASE_OUT } from "@/app/utils/motionPresets";

export type AnimatedItem = { key: string; node: React.ReactNode };

export default function AnimatedList({
  items,
  as: Host = "ul",
  className = "",
  itemClassName = "",
}: {
  items: AnimatedItem[];
  as?: "ul" | "ol";
  className?: string;
  itemClassName?: string;
}) {
  return (
    <Host className={className}>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <m.li
            key={it.key}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: MS.fast / 1000 } }}
            transition={{ duration: MS.base / 1000, ease: EASE_OUT }}
            className={itemClassName}
          >
            {it.node}
          </m.li>
        ))}
      </AnimatePresence>
    </Host>
  );
}
