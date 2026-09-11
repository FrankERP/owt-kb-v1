// The ONE date/month field (spec §19.3, decision M). NEUTRAL. The input stays
// native — the OS picker is the control — and the chrome is tokenised. In month
// kind an optional stepper pair turns it into a month strip; the parent owns
// what a step means (a router push, a state change). The schedule header does
// NOT use `onStep` (R2 Task 4 ruling: its own arrows page the month instead,
// with the same accessible names a second stepper pair would duplicate) — the
// one live consumer is the theme gallery's `ControlsFixture`.

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Button from "./Button";

const SIZE = {
  sm: "px-1.5 py-1 text-[11px]",
  md: "px-3 py-1.5 text-xs",
} as const;

export default function DateField({
  kind,
  label,
  size = "md",
  className = "",
  onStep,
  ...input
}: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "children" | "size"> & {
  kind: "date" | "month";
  label?: ReactNode;
  size?: keyof typeof SIZE;
  className?: string;
  /** Month strip: prev/next icon buttons around the input. `onStep(-1|1)` is the parent's job. */
  onStep?: (delta: -1 | 1) => void;
}) {
  const field = (
    <input
      type={kind}
      {...input}
      className={`min-w-0 rounded-lg border border-surface-accent-30 bg-transparent font-label text-ink-muted transition-[border-color,box-shadow] duration-fast ease-out-brand focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${SIZE[size]} ${onStep ? "" : "w-full"}`}
    />
  );
  return (
    <div className={`block ${className}`.trim()}>
      {label && (
        <label htmlFor={input.id} className="mb-1 block font-label text-[10px] uppercase tracking-widest text-mono-500">
          {label}
        </label>
      )}
      {onStep ? (
        <div className="inline-flex items-center gap-1">
          <Button variant="icon" aria-label="Mes anterior" onClick={() => onStep(-1)}>
            <span aria-hidden>‹</span>
          </Button>
          {field}
          <Button variant="icon" aria-label="Mes siguiente" onClick={() => onStep(1)}>
            <span aria-hidden>›</span>
          </Button>
        </div>
      ) : (
        field
      )}
    </div>
  );
}
