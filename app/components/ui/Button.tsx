// The house button (spec §4, §19.3). NEUTRAL module — no hooks — so Server
// Components render it as JSX and client components pass it handlers.
//
// Six variants replace the ~6 inline spellings the inventory counted across 305
// <button>s. Physics live in utilities so the 300 adopters carry no JS: press is
// `active:translate-y-px active:scale-[0.985]` over --motion-fast; the primary sheen
// is a brand.css class gated on (hover: hover); focus is always visible.
//
// `busy` is the ONLY loading affordance: aria-busy + disabled + a label swap. Never
// a spinner beside a label that says nothing.
//
// `className` is for additive utilities only — never to override padding, radius, or
// colour. Pick a variant or size instead.

import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon" | "pill";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 select-none font-label uppercase tracking-widest " +
  "transition-[color,background-color,border-color,transform,box-shadow] duration-fast ease-out-brand " +
  "active:translate-y-px active:scale-[0.985] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "brand-btn-sheen rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30",
  secondary:
    "rounded-lg border border-surface-accent-30 text-ink hover:border-accent dark:hover:border-surface-accent-30",
  ghost: "rounded-lg text-mono-500 hover:text-accent",
  danger: "rounded-lg bg-negative-surface/60 text-ink hover:bg-negative-border/60",
  icon: "rounded-lg w-9 h-9 p-0 text-mono-500 hover:text-accent hover:bg-surface-lift/5",
  pill: "rounded-full border border-surface-accent-30 text-mono-500 hover:text-accent aria-pressed:border-accent aria-pressed:text-accent aria-pressed:bg-accent/10",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-[11px] px-3 py-1",
  md: "text-xs px-4 py-2",
  lg: "text-xs px-4 min-h-[44px]",
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra = ""): string {
  const s = variant === "icon" ? (size === "lg" ? "min-h-[44px] min-w-[44px]" : "") : SIZE[size];
  return `${BASE} ${VARIANT[variant]} ${s} ${extra}`.replace(/\s+/g, " ").trim();
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
  active?: boolean;
  className?: string;
  children: ReactNode;
};

type ButtonOnlyProps = Common & Omit<ComponentPropsWithoutRef<"button">, "className" | "children"> & { href?: undefined };
type LinkOnlyProps = Common & Omit<ComponentPropsWithoutRef<"a">, "className" | "children"> & { href: string; busy?: never; busyLabel?: never };

export type ButtonProps = ButtonOnlyProps | LinkOnlyProps;

export default function Button(props: ButtonProps) {
  const { variant = "secondary", size = "md", busy = false, busyLabel, active, className = "", children } = props;
  const cls = buttonClass(variant, size, className);
  const label = busy && busyLabel ? busyLabel : children;

  if ("href" in props && typeof props.href === "string") {
    const { href, variant: _v, size: _s, active: _a, className: _c, children: _ch, ...rest } =
      props as LinkOnlyProps;
    return (
      <Link href={href} className={cls} {...rest}>
        {label}
      </Link>
    );
  }

  const { variant: _v, size: _s, busy: _b, busyLabel: _bl, active: _a, className: _c, children: _ch, type = "button", disabled, ...rest } =
    props as ButtonOnlyProps;
  return (
    <button
      type={type}
      className={cls}
      aria-busy={busy || undefined}
      aria-pressed={variant === "pill" ? active : undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {label}
    </button>
  );
}
