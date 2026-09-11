"use client";

// Availability as the ten next weekends (spec Part IV decision I, §12.4).
//
// The grid asked the member to find a date; this asks the question they actually
// answer — «¿este fin de semana puedes?» — in two taps, with the services they
// would be missing marked. Everything the rows read and write comes from the
// host's single `useAvailability`; the grid behind «Ver calendario» stays for a
// Tuesday rehearsal or a two-week trip.
//
// PRESSED MEANS «no puedo». The pill's own `aria-pressed` accent is overridden to
// the `availability` tone through `className`: those utilities are generated after
// `accent`'s (their keys sit later in `tailwind.config.ts`), so the later rule
// wins — this is the one ordering fact the two class sets depend on.

import Button from "@/app/components/ui/Button";
import { haptic } from "@/app/utils/haptics";
import { nextWeekends, weekendLabel } from "@/app/utils/weekends";
import { fmtDayLabel } from "./NotePopover";
import type { Availability } from "./useAvailability";

/** Ten weeks ahead: past the month a setlist is planned in, short enough to scan. */
const ROWS = 10;

const PRESSED_TONE =
  "relative aria-pressed:border-availability-strong aria-pressed:text-availability-strong aria-pressed:bg-availability-fg/20";

export default function WeekendList({
  state,
  serviceDates = [],
  openNote,
  closeNote,
  noteIso = null,
}: {
  state: Availability;
  serviceDates?: string[];
  /** Open the panel's note popover for a day, anchored to the control clicked. */
  openNote: (iso: string, anchor: HTMLElement) => void;
  closeNote: () => void;
  /** The date whose note popover is open, if any. */
  noteIso?: string | null;
}) {
  const { dates, notes, todayIso, toggle, upcomingCount } = state;
  const serviceSet = new Set(serviceDates);
  const weekends = nextWeekends(todayIso, ROWS);

  function day(iso: string, short: string) {
    const marked = dates.has(iso);
    const hasService = serviceSet.has(iso);
    const note = notes.get(iso)?.trim();
    return (
      <div className="flex flex-col items-center gap-1">
        <Button
          variant="pill"
          size="sm"
          active={marked}
          onClick={() => {
            // Un-marking drops the note with the date, so a popover still pinned
            // to it would be editing a reason that can never be saved.
            if (marked && noteIso === iso) closeNote();
            toggle(iso);
            void haptic("selection");
          }}
          aria-label={`${fmtDayLabel(iso)}${hasService ? ", hay servicio" : ""}${marked ? ", no puedo" : ""}`}
          className={PRESSED_TONE}
        >
          {short}
          {hasService && (
            <span
              aria-hidden="true"
              className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${marked ? "bg-availability-strong/60" : "bg-accent/70"}`}
            />
          )}
        </Button>
        {marked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={e => openNote(iso, e.currentTarget)}
            aria-label={`Razón para ${fmtDayLabel(iso)}${note ? ", con nota" : ""}`}
          >
            {note ? "Razón ✓" : "Razón"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-display text-lg uppercase tracking-wide">Disponibilidad</h3>
      <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
        Marca los fines de semana en que no puedes
      </p>

      <ul className="mt-3 divide-y divide-ink-dim/[0.06]">
        {weekends.map(w => (
          <li key={w.sat} className="flex items-start justify-between gap-3 py-2">
            <span className="font-body text-sm text-mono-300 pt-1.5">{weekendLabel(w)}</span>
            <div className="flex items-start gap-2">
              {day(w.sat, "SÁB")}
              {day(w.sun, "DOM")}
            </div>
          </li>
        ))}
      </ul>

      {upcomingCount > 0 && (
        <p className="font-label text-[11px] uppercase tracking-widest text-availability-strong mt-3">
          {upcomingCount} fecha{upcomingCount !== 1 ? "s" : ""} marcada{upcomingCount !== 1 ? "s" : ""} como no disponible
        </p>
      )}
    </div>
  );
}
