// The ONE select (spec §19.3, decision M) — the NATIVE half. The element stays a
// <select>: iOS's picker wheel is the better phone control, and every test that
// reaches one by label or querySelector keeps working. What changes is the
// chrome: tokenised border, focus glow, a drawn chevron over the hidden native
// arrow. The desktop Menu popover with type-ahead (>8 options) is Control Room
// work and is recorded as such in the spec's Part VIII.
//
// NEUTRAL — no hooks — so pass `id` with `label` (the label needs htmlFor) or
// name the control with `aria-label`.

import type { ComponentPropsWithoutRef, ReactNode } from "react";

const SIZE = {
  sm: "px-2 py-1 pr-8 text-[11px]",
  md: "px-3 py-2 pr-9 text-sm",
  lg: "min-h-[44px] px-3 py-2 pr-9 text-sm",
} as const;

type Base = Omit<ComponentPropsWithoutRef<"select">, "className" | "children" | "size"> & {
  size?: keyof typeof SIZE;
  className?: string;
  children: ReactNode;
};
type Props = (Base & { label: ReactNode; id: string }) | (Base & { label?: undefined });

export default function Select({ label, size = "md", className = "", children, ...select }: Props) {
  return (
    <div className={`block ${className}`.trim()}>
      {label && (
        <label htmlFor={select.id} className="mb-1 block font-label text-[10px] uppercase tracking-widest text-mono-500">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          {...select}
          className={`w-full appearance-none rounded-lg border border-surface-accent-30 bg-surface-raised-alt font-body text-ink transition-[border-color,box-shadow] duration-fast ease-out-brand focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${SIZE[size]}`}
        >
          {children}
        </select>
        <svg
          data-select-chevron=""
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mono-500"
        >
          <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
