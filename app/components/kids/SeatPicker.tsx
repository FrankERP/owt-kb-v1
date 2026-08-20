"use client";

import { useEffect } from "react";
import { useFocusTrap } from "@/app/utils/useFocusTrap";
import type { SeatView } from "@/app/utils/kidsPlannerView";
import { blockLabel, loadLabel, overlapLabel } from "./kidsPlannerLabels";

/**
 * The seat picker — one seat, one Sunday, every pair in its pool.
 *
 * This is the PRIMARY input on a phone (ADR-0012: drag is unusable on touch, and
 * a 20px chip is not a touch target), and the click/keyboard path on desktop, so
 * the board never needs a second mechanism to be operable.
 *
 * BLOCKED PAIRS ARE LISTED, NOT FILTERED. A row reading "Carlos y Paola — Vale no
 * disponible" answers the question the planner actually has; a missing row leaves
 * her wondering whether she mis-remembered the roster. Do not "tidy" these away.
 *
 * The order is `SeatView.options`' own: selectable first, longest-waiting first,
 * then blocked. So the FIRST selectable row is by construction the most overdue
 * pair for this seat — which is what "le toca" marks. No fact is re-derived here.
 */
export function SeatPicker({
  seatView,
  seatLabel,
  dateLabel,
  monthLoad,
  assignedName,
  onChoose,
  onClose,
}: {
  seatView: SeatView;
  seatLabel: string;
  dateLabel: string;
  monthLoad: Record<string, number>;
  /** The stored pair's name, for the "Quitar" row when it is not in the pool. */
  assignedName: string | null;
  onChoose: (pairId: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const nextUpId = seatView.options.find((option) => option.block === null)?.pairId ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-0 py-0 sm:items-center sm:px-4 sm:py-4">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-scrim/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${seatLabel} — ${dateLabel}`}
        tabIndex={-1}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-accent/20 bg-surface-raised-alt pb-[max(0.5rem,env(safe-area-inset-bottom))] focus:outline-none sm:rounded-2xl sm:pb-2"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-accent-subtle px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-base uppercase tracking-wide text-ink">{seatLabel}</p>
            <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
              {dateLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 min-h-[44px] min-w-[44px] rounded-lg font-display text-xl leading-none text-mono-400 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {seatView.unfillableReason && (
            <p className="rounded-lg border border-negative-strong/30 bg-negative-strong/10 px-3 py-2 font-body text-xs text-negative-fg">
              {seatView.unfillableReason}
            </p>
          )}

          {seatView.assignedPairId && (
            <button
              type="button"
              onClick={() => onChoose(null)}
              className="flex min-h-[44px] w-full items-center rounded-lg border border-edge-accent-subtle px-3 py-2 text-left font-body text-sm text-ink-dim transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Quitar {assignedName ?? "la pareja"} — dejar sin asignar
            </button>
          )}

          {seatView.options.length === 0 && (
            <p className="py-6 text-center font-body text-sm text-mono-500">
              Esta sala no tiene parejas registradas.
            </p>
          )}

          {seatView.options.map((option) => {
            const blocked = option.block !== null;
            const assigned = option.pairId === seatView.assignedPairId;
            const overlapText = overlapLabel(option.worshipOverlap);
            const load = loadLabel(monthLoad[option.pairId] ?? 0);
            return (
              <button
                key={option.pairId}
                type="button"
                disabled={blocked}
                aria-current={assigned ? "true" : undefined}
                onClick={() => onChoose(option.pairId)}
                className={`flex min-h-[44px] w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  blocked
                    ? "cursor-not-allowed border-edge-accent-subtle bg-surface-sunken/60 opacity-70"
                    : assigned
                      ? "border-accent/50 bg-accent/10"
                      : "border-edge-accent-subtle hover:border-accent/40 hover:bg-accent/5"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-body text-sm ${blocked ? "text-ink-dim" : "text-ink"}`}
                  >
                    {assigned && <span aria-hidden="true">✓ </span>}
                    {option.name}
                  </span>
                  {option.block && (
                    <span className="block font-label text-[11px] leading-tight text-negative-fg">
                      {blockLabel(option.block)}
                    </span>
                  )}
                  {!blocked && overlapText && (
                    <span className="block font-label text-[11px] leading-tight text-warning-strong">
                      {overlapText}
                    </span>
                  )}
                  {!blocked && load && (
                    <span className="block font-label text-[11px] leading-tight text-mono-500">
                      {load}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">
                    {option.weeksSinceLabel}
                  </span>
                  {option.pairId === nextUpId && (
                    <span className="block font-label text-[11px] uppercase tracking-widest text-accent">
                      le toca
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
