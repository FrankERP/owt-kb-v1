// app/components/ui/Skeleton.tsx
// Shimmer placeholder (spec §4). NEUTRAL module — no hooks, no "use client" — so
// loading.tsx files, which are Server Components, render it as JSX. Sizing comes
// from Tailwind utilities on `className`; the sweep lives in brand.css.

import type { ComponentPropsWithoutRef } from "react";

const RADIUS = { sm: "rounded", md: "rounded-md", lg: "rounded-xl", full: "rounded-full" } as const;

type Props = ComponentPropsWithoutRef<"div"> & { rounded?: keyof typeof RADIUS };

export default function Skeleton({ className = "", rounded = "md", ...rest }: Props) {
  return <div aria-hidden="true" className={`brand-skeleton ${RADIUS[rounded]} ${className}`} {...rest} />;
}

/** One live region per loading surface, so a screen reader hears "cargando" once. */
export function SkeletonGroup({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

// Navbar renders per page (not in the layout), so a loading.tsx that skips this
// placeholder lets the top bar vanish and reappear on every route transition.
// Draws the three shapes (mark, title, avatar) so the swap to the real bar is invisible.
export function NavbarSkeleton() {
  return (
    <div aria-hidden="true" className="pt-[env(safe-area-inset-top)] border-b border-surface-accent-20">
      <div className="mx-auto max-w-7xl h-20 lg:h-24 flex items-center gap-3 sm:gap-5 ps-[max(1.25rem,env(safe-area-inset-left))] pe-[max(1.25rem,env(safe-area-inset-right))]">
        <Skeleton className="h-12 w-12 lg:h-16 lg:w-16 shrink-0" rounded="lg" />
        <Skeleton className="mx-auto h-4 w-24 sm:w-32" />
        <Skeleton className="h-9 w-9 shrink-0 ml-auto" rounded="full" />
      </div>
    </div>
  );
}
