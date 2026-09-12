"use client";

// `/me`'s availability panel (R3): the weekend list, the shared recurring
// pattern, the save, and the twelve-month grid behind «Ver calendario».
//
// ONE `useAvailability` for the whole panel, and that is the point of the host:
// two surfaces edit the same `unavailableDates` against ONE revision. Two hook
// calls would be two revisions, two dirty fingerprints and two save buttons
// racing each other into the same Sanity document — the lost update the route's
// `ifRevisionId` guard exists to refuse.
//
// The note popover is the host's too, for the same reason the hook is: a conflict
// replaces the local arrays, so the date a popover is pinned to can be gone.
// `onAdopt` closes it in the SAME update the adoption lands in.
//
// `saved` is no longer rendered anywhere — a successful save is a toast, fired
// from the hook's `onSaved`, so nothing in the panel has to infer success from a
// flag that is also false while saving.

import { useRef, useState } from "react";
import AvailabilityGrid from "./AvailabilityGrid";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import Select from "@/app/components/ui/Select";
import { useToast } from "@/app/components/ui/Toast";
import NotePopover, { popoverPosition, type NoteAnchor } from "./NotePopover";
import WeekendList from "./WeekendList";
import { useAvailability } from "./useAvailability";

interface Props {
  /** The revision this page was rendered at — the save's `ifRevisionId` guard. */
  initialRev: string;
  initialDates: string[];
  serviceDates?: string[];
  initialNotes?: { date: string; note: string }[];
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function MyAvailabilityPanel({ initialRev, initialDates, serviceDates = [], initialNotes = [] }: Props) {
  const { toast } = useToast();

  const [popover, setPopover] = useState<NoteAnchor | null>(null);
  // The control the open popover belongs to, so its position can be recomputed
  // rather than frozen at click time.
  const anchorRef = useRef<HTMLElement | null>(null);

  const [gridOpen, setGridOpen] = useState(false);
  const [recurOpen, setRecurOpen]         = useState(false);
  const [recurDow, setRecurDow]           = useState(0); // 0 = Domingo
  const [recurInterval, setRecurInterval] = useState(1);

  const state = useAvailability({
    initialRev, initialDates, initialNotes,
    // A conflict drops the pending edits, so the popover can be pinned to a date
    // that is gone — it closes in the same update the adoption lands in.
    onAdopt: () => setPopover(null),
    onSaved: () => toast({ message: "Guardado ✓", tone: "ok", duration: 2500 }),
  });
  const { notes, setNote, remove, applyRecurring, save, saving, dirty, saveError, conflict } = state;

  // `isos` arrives from the grid's drag-select: one popover, one «Razón», every
  // day in the span. `iso` stays the anchor and the positioning key.
  function openNote(iso: string, anchor: HTMLElement, isos?: string[]) {
    anchorRef.current = anchor;
    setPopover({ iso, isos, ...popoverPosition(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight) });
  }
  const closeNote = () => setPopover(null);

  function applySeries(add: boolean) {
    // «Quitar serie» can drop the very date the note popover is pinned to — the
    // last seam `onAdopt` doesn't cover, because this isn't a conflict, it's the
    // member's own edit. Close it here, before the removal, rather than leaving
    // it open on a date no longer marked.
    if (!add) closeNote();
    applyRecurring(recurDow, recurInterval, add);
    setRecurOpen(false);
  }

  // The range by dates moved into the grid (R3 F2), beside the drag that
  // expresses the same thing — so there is no second panel to keep mutually
  // exclusive with «Repetir…» here any more.
  function toggleRecur() {
    setRecurOpen(v => !v);
  }

  return (
    <div className="space-y-4">
      <WeekendList
        state={state}
        serviceDates={serviceDates}
        openNote={openNote}
        closeNote={closeNote}
        noteIso={popover?.iso ?? null}
      />

      {/* The actions, and the recurring panel one of them opens. They share a
          wrapper so the panel is not a child of `space-y-4`: a closed Collapse is
          a zero-height child, but the 16px gap around it would still be reserved. */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={toggleRecur}
            aria-expanded={recurOpen}
            aria-controls="availability-recur"
          >
            Repetir…
          </Button>
          <Button
            variant="primary"
            onClick={save}
            busy={saving}
            busyLabel="Guardando…"
            disabled={!dirty}
          >
            Guardar
          </Button>
        </div>

        {/* Recurring pattern */}
        <Collapse open={recurOpen} id="availability-recur" className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-accent/70">
            Marcar un día recurrente como no disponible
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Día de la semana" value={recurDow} onChange={e => setRecurDow(Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => <option key={i} value={i} className="bg-surface-base">{w}</option>)}
            </Select>
            <Select aria-label="Cada cuántas semanas" value={recurInterval} onChange={e => setRecurInterval(Number(e.target.value))}>
              <option value={1} className="bg-surface-base">Cada semana</option>
              <option value={2} className="bg-surface-base">Cada 2 semanas</option>
              <option value={4} className="bg-surface-base">Cada 4 semanas</option>
            </Select>
            <Button variant="primary" onClick={() => applySeries(true)}>Marcar</Button>
            <Button onClick={() => applySeries(false)}>Quitar serie</Button>
          </div>
          <p className="font-body text-xs text-mono-500">
            <span className="text-mono-400">Marcar</span> agrega o <span className="text-mono-400">Quitar serie</span> borra ese día durante los próximos 12 meses. Puedes ajustar días sueltos después; recuerda <span className="text-mono-400">Guardar</span>.
          </p>
        </Collapse>
      </div>

      {dirty && !saving && (
        <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
          Cambios sin guardar
        </p>
      )}

      {saveError && (
        <p className="font-label text-[11px] uppercase tracking-widest text-negative-fg">
          No se pudo guardar — {saveError}
        </p>
      )}

      {conflict && (
        <p
          role="status"
          className="rounded-xl border border-negative-strong/25 bg-negative-strong/5 px-4 py-2 font-body text-sm text-negative-fg"
        >
          {conflict}
        </p>
      )}

      {/* The grid, for what ten weekend rows cannot say. Same wrapper reason as
          the recurring panel above. */}
      <div>
        <Button
          variant="ghost"
          onClick={() => setGridOpen(v => !v)}
          aria-expanded={gridOpen}
          aria-controls="availability-grid"
        >
          Ver calendario
        </Button>
        <Collapse open={gridOpen} id="availability-grid" className="mt-4">
          <AvailabilityGrid
            state={state}
            serviceDates={serviceDates}
            openNote={openNote}
            closeNote={closeNote}
            noteIso={popover?.iso ?? null}
          />
        </Collapse>
      </div>

      <NotePopover
        popover={popover}
        setPopover={setPopover}
        anchorRef={anchorRef}
        notes={notes}
        setNote={setNote}
        remove={remove}
      />
    </div>
  );
}
