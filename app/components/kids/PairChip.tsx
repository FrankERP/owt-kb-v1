"use client";

import type { DragEvent } from "react";
import { overlapLabel } from "./kidsPlannerLabels";

/**
 * One pair, as a chip.
 *
 * Deliberately the SAME chip language as the worship month grid
 * (`PlannerGrid.tsx`): `rounded-full border px-1.5 py-0.5 font-label text-xs`.
 * Two rotation boards in one app that look like different products is a cost with
 * no upside.
 *
 * The worship overlap is amber and INFORMATIONAL — never a block — and it names
 * the person, because "alguien también sirve en alabanza" is not actionable. The
 * name renders as a visible line under the chip rather than inside it: inside, a
 * two-name overlap would blow out a desktop board column.
 */
export function PairChip({
  name,
  weeksSinceLabel,
  overlap = [],
  nextUp = false,
  note = null,
  hint = null,
  blocked = false,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  name: string;
  weeksSinceLabel?: string | null;
  overlap?: string[];
  nextUp?: boolean;
  /** Anything extra worth saying under the chip — the block reason, the load, etc. */
  note?: string | null;
  /** Hover text. Use it to explain a chip that deliberately will NOT drag; a chip
   *  that refuses to lift with no reason reads as broken. */
  hint?: string | null;
  /** Muted, and the note reads as a refusal. The bench's "why not" state. */
  blocked?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLSpanElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLSpanElement>) => void;
}) {
  const overlapped = overlap.length > 0;
  const overlapText = overlapLabel(overlap);

  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span
        draggable={draggable || undefined}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        // The person is named on the accessible name too, so the amber mark is not
        // the only carrier of the warning. An explicit `hint` wins: it explains an
        // interaction, which beats restating a warning the chip already shows.
        title={hint ?? overlapText ?? undefined}
        className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 font-label text-xs ${
          blocked
            ? "border-edge-accent-subtle bg-surface-sunken text-ink-muted"
            : overlapped
              ? "border-warning-fg/40 bg-warning-fg/10 text-warning-fg"
              : "border-accent/25 bg-accent/10 text-ink-muted"
        } ${nextUp ? "ring-2 ring-accent" : ""} ${draggable ? "cursor-grab" : ""} ${
          dragging ? "opacity-30" : ""
        }`}
      >
        <span className="truncate">{name}</span>
        {overlapped && <span aria-hidden="true">♪</span>}
      </span>

      {weeksSinceLabel && (
        <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">
          {weeksSinceLabel}
          {nextUp && <span className="ml-1 text-accent">· le toca</span>}
        </span>
      )}

      {overlapText && (
        <span className="font-label text-[11px] leading-tight text-warning-fg">
          {overlapText}
        </span>
      )}

      {note && (
        <span
          className={`font-label text-[11px] leading-tight ${
            blocked ? "text-negative-fg" : "text-ink-dim"
          }`}
        >
          {note}
        </span>
      )}
    </span>
  );
}
