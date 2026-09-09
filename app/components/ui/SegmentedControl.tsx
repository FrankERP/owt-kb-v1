"use client";

// The ONE segmented control (spec §4, §19.3): CALENDARIO / LISTA, POPULAR / A–Z,
// TIPO / ROL, A→Z / Z→A, theme, text size, proposal filters, chart tabs. Radio
// semantics — one of these, not N toggles — with the thumb as a single
// `layoutId` element that slides to whichever option is checked. That is the
// layout projection M0b-1 switched the feature chunk to `domMax` for.
//
// `value: null` is a real state (ThemeControl before the projection lands): no
// thumb, and the FIRST option is the tab stop so the keyboard can still enter.

import { useId, type KeyboardEvent } from "react";
import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";
import { haptic } from "@/app/utils/haptics";

export type SegmentedOption<V extends string> = {
  value: V;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text (e.g. "D · versión 1 de 2"). */
  ariaLabel?: string;
  /** A count badge drawn at the option's corner (Propuestas → Pendientes). */
  badge?: number;
  /** aria-busy on that option while a write is in flight (ThemeControl). */
  busy?: boolean;
};

export type SegmentedControlProps<V extends string> = {
  /** Accessible name of the group. Pass exactly one of `label` / `labelledBy`. */
  label?: string;
  labelledBy?: string;
  /** `null` = nothing selected yet (ThemeControl before the projection lands). */
  value: V | null;
  onChange: (value: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  size?: "sm" | "md";
  /** `outline`: tinted thumb, bordered pills (default). `filled`: solid accent thumb, joined bar. */
  tone?: "outline" | "filled";
  /** Additive utilities on the group element only. */
  className?: string;
};

const SIZE = {
  sm: "px-3 py-1.5 text-[11px]",
  md: "px-4 py-2 text-xs",
} as const;

const GROUP = {
  outline: "flex flex-wrap gap-2",
  filled: "inline-flex overflow-hidden rounded-lg border border-surface-accent-30",
} as const;

const OPTION = {
  outline: "rounded-full border border-surface-accent-l25-d20 text-mono-500 hover:border-accent/50 hover:text-accent aria-checked:border-accent aria-checked:text-accent",
  filled: "text-mono-500 hover:text-ink-muted aria-checked:text-on-fill border-l border-surface-accent-30 first:border-l-0",
} as const;

const THUMB = {
  outline: "rounded-full bg-accent/10",
  filled: "bg-surface-accent-solid",
} as const;

export default function SegmentedControl<V extends string>({
  label,
  labelledBy,
  value,
  onChange,
  options,
  size = "md",
  tone = "outline",
  className = "",
}: SegmentedControlProps<V>) {
  const layoutId = useId();
  const index = options.findIndex((o) => o.value === value);

  // Commits a navigation to `next` (wrapped) unconditionally — used by both
  // click (once the caller has already screened out the no-op "click the
  // option that's already checked" case) and every keyboard move. Keyboard
  // navigation always commits, even when it lands back on the currently
  // checked option (e.g. End on the last option), because it is a deliberate
  // move gesture, not a redundant click.
  const commit = (next: number) => {
    const opt = options[(next + options.length) % options.length];
    if (!opt) return;
    void haptic("light");
    onChange(opt.value);
  };

  const select = (i: number) => {
    // A click on the option that's already checked must not fire onChange or
    // a haptic (spec note b).
    if (i === index) return;
    commit(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const from = index >= 0 ? index : i;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = from + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = from - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    commit(next);
    // Selection follows focus, as native radios do; the radio we move to is the
    // one that becomes the tab stop on the next render.
    const target = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[
      (next + options.length) % options.length
    ];
    target?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`${GROUP[tone]} ${className}`.trim()}
    >
      {options.map((o, i) => {
        const checked = i === index;
        // With nothing selected the first option carries the tab stop.
        const tabStop = index >= 0 ? checked : i === 0;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            aria-busy={o.busy || undefined}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative select-none font-label uppercase tracking-widest transition-colors duration-fast ease-out-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base ${SIZE[size]} ${OPTION[tone]} ${o.busy ? "opacity-60" : ""}`}
          >
            {checked && (
              <m.span
                data-segmented-thumb=""
                aria-hidden
                layoutId={layoutId}
                initial={false}
                transition={SPRINGS.settle}
                className={`absolute inset-0 -z-10 ${THUMB[tone]}`}
              />
            )}
            <span className="relative">{o.label}</span>
            {o.busy && <span className="sr-only"> — guardando</span>}
            {typeof o.badge === "number" && o.badge > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-recency-fg text-[10px] font-bold text-scrim">
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
