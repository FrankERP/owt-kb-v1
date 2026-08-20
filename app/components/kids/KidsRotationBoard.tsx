"use client";

import { useState } from "react";
import {
  KIDS_ROOMS,
  KIDS_SEATS,
  KIDS_SEAT_LABELS,
  type KidsSeat,
} from "@/app/utils/kidsTypes";
import type { KidsRoom } from "@/app/utils/kidsTypes";
import type { BenchEntry } from "@/app/utils/kidsPlannerView";
import type { KidsBoardProps } from "./kidsBoardProps";
import { PairChip } from "./PairChip";
import { blockLabel, canPlace, loadLabel } from "./kidsPlannerLabels";

/** Where a drag started: a bench chip (`from === null`) or a filled cell. */
export interface DragSource {
  pairId: string;
  from: { date: string; seat: KidsSeat } | null;
}

/**
 * The rotation board — Sundays across, the four seats down, one chip per cell.
 *
 * DESKTOP ONLY (`hidden md:block` at the call site), and that is a decision, not
 * an oversight: HTML5 drag never fires from a touch (ADR-0012 DD8), so a board
 * shrunk onto a phone would be a picture of a planner rather than a planner. The
 * phone gets `KidsSundayCards`.
 *
 * Drag is the ACCELERATOR, never the only way in: every cell is also a button
 * that opens the same picker the phone uses, so mouse, keyboard and assistive
 * tech reach every move without a second mechanism to keep in sync.
 *
 * Below the board, one bench per room, longest-waiting first, with "le toca" on
 * the pair whose turn it is. That ordering is `PlannerView.bench`'s, not this
 * component's — the board explains the rotation, it does not compute it.
 */
export function KidsRotationBoard({
  sundays,
  seatOf,
  pairName,
  monthLoad,
  noteFor,
  busy,
  onOpenSeat,
  onTogglePublish,
  bench,
  benchAnchorLabel,
  onMove,
}: KidsBoardProps & {
  bench: Record<KidsRoom, BenchEntry[]>;
  /** The Sunday the bench's clocks and blocks are measured at — `PlannerView` anchors
   *  them to the first Sunday of the window, so saying so beats implying "always". */
  benchAnchorLabel: string | null;
  onMove: (source: DragSource, to: { date: string; seat: KidsSeat }) => void;
}) {
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const cellKey = (date: string, seat: KidsSeat) => `${date}::${seat}`;

  const allowed = (date: string, seat: KidsSeat): boolean =>
    drag !== null && canPlace(seatOf(date, seat), drag.pairId, drag.from).ok;

  const startDrag = (source: DragSource) => (e: React.DragEvent) => {
    e.stopPropagation();
    // A payload is set because Firefox starts no drag without one; the component
    // reads its own state, not this string, since `getData` is unreadable during
    // `dragover` — which is exactly when the drop target must decide.
    e.dataTransfer.setData("text/plain", source.pairId);
    e.dataTransfer.effectAllowed = "move";
    setDrag(source);
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  const dropHandlers = (date: string, seat: KidsSeat) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!allowed(date, seat)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(cellKey(date, seat));
    },
    onDragLeave: () => setOver((current) => (current === cellKey(date, seat) ? null : current)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const source = drag;
      endDrag();
      if (!source) return;
      onMove(source, { date, seat });
    },
  });

  return (
    <div className="hidden md:block">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-2">
          <caption className="sr-only">
            Rotación de Oasis Kids: un domingo por columna, un lugar por fila.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-36">
                <span className="sr-only">Lugar</span>
              </th>
              {sundays.map((sunday) => (
                <th key={sunday.date} scope="col" className="align-top">
                  <div className="space-y-1 rounded-xl border border-accent/15 bg-surface-accent-wash px-3 py-2 text-left">
                    <p className="font-display text-sm uppercase tracking-wide text-ink">
                      {sunday.label}
                    </p>
                    <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                      {sunday.filled} de {KIDS_SEATS.length} lugares
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
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
                        className="min-h-[36px] rounded-lg border border-accent/25 px-2 font-label text-[11px] uppercase tracking-widest text-accent transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                      >
                        {sunday.publishing ? "…" : sunday.published ? "Despublicar" : "Publicar"}
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KIDS_SEATS.map((seat) => (
              <tr key={seat}>
                <th
                  scope="row"
                  className="align-top font-label text-[11px] uppercase tracking-widest text-mono-500"
                >
                  <span className="block pt-3 text-left">{KIDS_SEAT_LABELS[seat]}</span>
                </th>
                {sundays.map((sunday) => {
                  const seatView = seatOf(sunday.date, seat);
                  const assignedId = seatView.assignedPairId;
                  const option = assignedId
                    ? seatView.options.find((o) => o.pairId === assignedId)
                    : undefined;
                  const note = noteFor(sunday.date, seat);
                  const isOver = over === cellKey(sunday.date, seat);
                  const dropOk = allowed(sunday.date, seat);
                  return (
                    <td key={sunday.date} className="align-top" {...dropHandlers(sunday.date, seat)}>
                      <button
                        type="button"
                        onClick={() => onOpenSeat(sunday.date, seat)}
                        disabled={busy}
                        aria-label={`${KIDS_SEAT_LABELS[seat]}, ${sunday.label}: ${
                          assignedId ? pairName(assignedId) : "sin asignar"
                        }`}
                        className={`flex min-h-[76px] w-full flex-col items-start gap-1 rounded-xl border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 ${
                          isOver && dropOk
                            ? "border-accent bg-accent/10"
                            : drag !== null && dropOk
                              ? "border-accent/40 border-dashed bg-surface-accent-faint"
                              : "border-edge-accent-subtle bg-surface-accent-faint hover:border-accent/40"
                        }`}
                      >
                        {assignedId ? (
                          <PairChip
                            name={option?.name ?? pairName(assignedId)}
                            weeksSinceLabel={option?.weeksSinceLabel}
                            overlap={option?.worshipOverlap ?? []}
                            note={option ? null : "Fuera de la rotación"}
                            draggable
                            dragging={drag?.pairId === assignedId && drag.from?.seat === seat}
                            onDragStart={startDrag({
                              pairId: assignedId,
                              from: { date: sunday.date, seat },
                            })}
                            onDragEnd={endDrag}
                          />
                        ) : (
                          <span className="font-label text-[11px] uppercase tracking-widest text-ink-dim">
                            + Asignar
                          </span>
                        )}
                        {note && (
                          <span className="font-label text-[11px] leading-tight text-negative-fg">
                            {note}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <h3 className="font-display text-sm uppercase tracking-wide text-ink">Banca</h3>
          <p className="font-body text-xs text-mono-500">
            {/* One expression, not JSX siblings: a line break between text and a
                `{…}` renders as a space, which would put one before the comma. */}
            {`Quién lleva más tiempo esperando en cada sala${
              benchAnchorLabel ? `, al ${benchAnchorLabel.toLowerCase()}` : ""
            }. Arrastra una pareja a un domingo, o toca un lugar del tablero para elegir.`}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {KIDS_ROOMS.map((room) => (
            <div
              key={room}
              className="space-y-2 rounded-xl border border-accent/15 bg-surface-accent-wash p-3"
            >
              <h4 className="font-label text-[11px] uppercase tracking-widest text-mono-500">
                {KIDS_SEAT_LABELS[room]}
              </h4>
              <ul className="space-y-2">
                {bench[room].map((entry: BenchEntry) => (
                  <li key={entry.pairId} className="flex items-start justify-between gap-2">
                    <PairChip
                      name={entry.name}
                      weeksSinceLabel={entry.weeksSinceLabel}
                      overlap={entry.worshipOverlap}
                      nextUp={entry.nextUp}
                      note={entry.block ? blockLabel(entry.block) : loadLabel(monthLoad[entry.pairId] ?? 0)}
                      blocked={entry.block !== null}
                      draggable={entry.block === null && !busy}
                      dragging={drag?.pairId === entry.pairId && drag.from === null}
                      onDragStart={startDrag({ pairId: entry.pairId, from: null })}
                      onDragEnd={endDrag}
                    />
                  </li>
                ))}
                {bench[room].length === 0 && (
                  <li className="font-body text-xs text-mono-500">Sin parejas registradas.</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
