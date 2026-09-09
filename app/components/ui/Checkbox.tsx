// The ONE checkbox (spec §19.3, decision M). NEUTRAL — no hooks, no motion — so a
// Server Component may render it. The native input stays (sr-only) and does all
// the work: name, keyboard, checked, disabled, form participation, and every
// test that reaches a checkbox by role or label. The box is drawn beside it and
// the mark scales in over --motion-base; only transform animates.
//
// Tailwind's `peer-*` variants match SIBLINGS of the input, so the reveal is
// written on the box span and reaches the svg through an arbitrary variant:
// `peer-checked:[&>svg]:scale-100`. No `:has()` anywhere — the floor bans it.
// `stroke="currentColor"` with `text-on-fill` on the svg: `var()` is not
// substituted inside SVG presentation attributes (CLAUDE.md, Colour tokens).

import type { ComponentPropsWithoutRef, ReactNode } from "react";

const TONE = {
  accent: "peer-checked:border-accent peer-checked:bg-accent",
  negative: "peer-checked:border-negative-fg peer-checked:bg-negative-fg",
} as const;

export default function Checkbox({
  children,
  tone = "accent",
  className = "",
  ...input
}: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children"> & {
  /** Visible label. When omitted, pass `aria-label`. */
  children?: ReactNode;
  tone?: keyof typeof TONE;
  /** Additive utilities on the wrapping <label>. */
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 ${className}`.trim()}>
      <input type="checkbox" className="peer sr-only" {...input} />
      <span
        aria-hidden
        data-checkbox-box=""
        className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-surface-accent-30 bg-transparent transition-colors duration-fast ease-out-brand peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-checked:[&>svg]:scale-100 ${TONE[tone]}`}
      >
        <svg
          data-checkbox-mark=""
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5 scale-0 text-on-fill transition-transform duration-base ease-out-brand"
        >
          <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children && <span className="min-w-0">{children}</span>}
    </label>
  );
}
