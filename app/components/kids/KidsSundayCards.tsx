"use client";

import { KIDS_SEATS, KIDS_SEAT_LABELS } from "@/app/utils/kidsTypes";
import type { KidsBoardProps } from "./kidsBoardProps";
import { PairChip } from "./PairChip";

/**
 * The phone layout — one card per Sunday, four tappable seats each.
 *
 * THIS IS THE PRIMARY EXPERIENCE, not a fallback: the planning happens on Niza's
 * phone. So the seat row is the target (≥44px, full width, the whole row), the
 * picker opens on tap, and nothing here depends on a gesture a touch cannot
 * produce (ADR-0012).
 *
 * Each row answers the two questions a dropdown hid: who is in the seat, and how
 * long since that pair last held it.
 */
export function KidsSundayCards({
  sundays,
  seatOf,
  pairName,
  noteFor,
  busy,
  onOpenSeat,
  onTogglePublish,
}: KidsBoardProps) {
  return (
    <div className="space-y-4 md:hidden">
      {sundays.map((sunday) => (
        <section
          key={sunday.date}
          aria-label={sunday.label}
          className="space-y-3 rounded-xl border border-accent/15 bg-surface-accent-wash p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-display text-base uppercase tracking-wide text-ink">
                {sunday.label}
              </p>
              <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                {sunday.filled} de {KIDS_SEATS.length} lugares asignados
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${
                  sunday.published
                    ? "bg-positive-deep/10 text-positive-strong"
                    : "bg-surface-sunken text-mono-500"
                }`}
              >
                {sunday.published ? "Publicado" : "Borrador"}
              </span>
              <button
                type="button"
                onClick={() => onTogglePublish(sunday.date, !sunday.published)}
                disabled={busy || (!sunday.published && sunday.filled === 0)}
                title={
                  !sunday.published && sunday.filled === 0
                    ? "Asigna al menos una pareja antes de publicar"
                    : undefined
                }
                className="min-h-[44px] rounded-lg border border-accent/25 px-3 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                {sunday.publishing ? "…" : sunday.published ? "Despublicar" : "Publicar"}
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {KIDS_SEATS.map((seat) => {
              const seatView = seatOf(sunday.date, seat);
              const assignedId = seatView.assignedPairId;
              const option = assignedId
                ? seatView.options.find((o) => o.pairId === assignedId)
                : undefined;
              const note = noteFor(sunday.date, seat);
              return (
                <li key={seat}>
                  <button
                    type="button"
                    onClick={() => onOpenSeat(sunday.date, seat)}
                    disabled={busy}
                    aria-label={`${KIDS_SEAT_LABELS[seat]}: ${
                      assignedId ? pairName(assignedId) : "sin asignar"
                    }. Cambiar`}
                    className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg border border-edge-accent-subtle bg-surface-accent-faint px-3 py-2 text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">
                        {KIDS_SEAT_LABELS[seat]}
                      </span>
                      {assignedId ? (
                        <PairChip
                          name={option?.name ?? pairName(assignedId)}
                          weeksSinceLabel={option?.weeksSinceLabel}
                          overlap={option?.worshipOverlap ?? []}
                          note={option ? null : "Fuera de la rotación"}
                        />
                      ) : (
                        <span className="block font-body text-sm text-ink-dim">Sin asignar</span>
                      )}
                      {note && (
                        <span className="block font-label text-[11px] leading-tight text-negative-fg">
                          {note}
                        </span>
                      )}
                    </span>
                    <span aria-hidden="true" className="shrink-0 font-label text-xs text-accent">
                      Cambiar ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
