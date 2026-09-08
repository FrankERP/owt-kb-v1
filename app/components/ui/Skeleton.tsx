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
// Height classes must track Navbar.tsx's `h-20 lg:h-24` + safe-area top exactly.
export function NavbarSkeleton() {
  return (
    <div aria-hidden="true" className="h-[calc(5rem+env(safe-area-inset-top))] lg:h-[calc(6rem+env(safe-area-inset-top))] border-b border-surface-accent-20" />
  );
}
