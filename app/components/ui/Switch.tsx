"use client";

// The ONE switch (spec §4, §19.3): EmailPrefToggles' knob promoted, with a spring
// and a haptic on the flip. Keeps the a11y contract the two sites' tests pin —
// role=switch, aria-checked, a name from aria-label — and stays a <button>, so
// Space/Enter toggle and `disabled` drops it from the tab order.
//
// `initial={false}`: the knob renders at its resting position on first paint,
// before the async feature chunk arrives — a switch that shows "off" for a
// beat while it is "on" is a lie, not a loading state.

import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";
import { haptic } from "@/app/utils/haptics";

const SIZE = {
  sm: { track: "h-5 w-9", knob: "h-4 w-4", travel: 16 },
  md: { track: "h-6 w-11", knob: "h-5 w-5", travel: 20 },
} as const;

export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className = "",
  ...aria
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Exactly one of these names the switch. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const s = SIZE[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={() => { void haptic("light"); onChange(!checked); }}
      className={`relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-base ease-out-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:opacity-50 ${s.track} ${
        checked ? "bg-accent" : "bg-mono-300 dark:bg-mono-600"
      } ${className}`.trim()}
    >
      <m.span
        data-switch-knob=""
        aria-hidden
        initial={false}
        animate={{ x: checked ? s.travel : 0 }}
        transition={SPRINGS.pop}
        className={`pointer-events-none block rounded-full bg-white shadow-sm ${s.knob}`}
      />
    </button>
  );
}
