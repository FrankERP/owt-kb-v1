"use client";

// `/me/disponibilidad`'s availability panel (R3, split out in F3): the
// twelve-month grid, the shared recurring pattern, and the save.
//
// ONE `useAvailability` for the whole panel, and that is still the point of the
// host even now that the grid is its only surface: every edit — a tap, a drag, a
// recurring series — goes through ONE revision and ONE dirty fingerprint. Two
// hook calls would be two revisions and two save buttons racing each other into
// the same Sanity document, the lost update the route's `ifRevisionId` guard
// exists to refuse.
//
// F3 retired the weekend pills and the Desde/Hasta fields: the calendar is the
// page, so it is mounted open rather than hidden behind «Ver calendario», and it
// is the one way to mark a date.
//
// The note popover is the host's too, for the same reason the hook is: a conflict
// replaces the local arrays, so the date a popover is pinned to can be gone.
// `onAdopt` closes it in the SAME update the adoption lands in.
//
// `saved` is no longer rendered anywhere — a successful save is a toast, fired
// from the hook's `onSaved`, so nothing in the panel has to infer success from a
// flag that is also false while saving.
//
// Design pass C (2026-10-22) moved two things here from where they were:
//
// * The selection MODE. `selecting` was the grid's own state behind a `pill`
//   above its pager; now the host holds it and `MarkDaysButton` («Marcar días» ⇄
//   «Listo»), the page's primary action, sits first in the top row beside
//   «Repetir…». The grid takes it as a prop and cleans up on each flip.
// * «Guardar». It was a disabled button in the top row with an amber «Cambios
//   sin guardar» eyebrow under it, two screens above the month a member was
//   editing. Now it is a STICKY bar at the bottom — «N cambios sin guardar ·
//   Guardar» — present only while there is something to save (or a save in
//   flight), clearing the phone tab bar through `--bottom-nav-h` like the
//   other fixed-bottom surfaces (`bottomNavOffsetSync.test.ts`). A save error
//   reads in the same bar, next to the button that can retry it.
//
// The «millones» pass (2026-10-26) made the panel's first line the page's LEDE
// — «5 días marcados · el viernes es ensayo», 17 px under the display title —
// in place of an uppercase tracked eyebrow in the availability colour and a
// separate explanatory sentence on the page: the count is the one fact a
// member checks, and it is live (the hook's `upcomingCount` follows every
// edit), which is why the line lives here and not in the Server Component.
// The mode hint («Toca «Marcar días»…» ⇄ «Toca un día… Mantén presionado…») moved
// here from the grid for the same reason the mode did: it reads under the
// button that flips it. «Repetir…» is a ghost beside the primary, and its
// panel a hairline block rather than a tinted card.

import { useRef, useState } from "react";
import AvailabilityGrid from "./AvailabilityGrid";
import MarkDaysButton from "./MarkDaysButton";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import Select from "@/app/components/ui/Select";
import { useToast } from "@/app/components/ui/Toast";
import NotePopover, { popoverPosition, type NoteAnchor } from "./NotePopover";
import { useAvailability } from "./useAvailability";
import type { Tone } from "@/app/utils/agenda";

interface Props {
  /** The revision this page was rendered at — the save's `ifRevisionId` guard. */
  initialRev: string;
  initialDates: string[];
  /** The services per day, in the agenda's tone vocabulary (the grid's dots). */
  services?: Record<string, Tone[]>;
  initialNotes?: { date: string; note: string }[];
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function MyAvailabilityPanel({ initialRev, initialDates, services = {}, initialNotes = [] }: Props) {
  const { toast } = useToast();

  const [popover, setPopover] = useState<NoteAnchor | null>(null);
  // The control the open popover belongs to, so its position can be recomputed
  // rather than frozen at click time.
  const anchorRef = useRef<HTMLElement | null>(null);

  const [selecting, setSelecting]         = useState(false);
  const [recurOpen, setRecurOpen]         = useState(false);
  const [recurDow, setRecurDow]           = useState(0); // 0 = Domingo
  const [recurInterval, setRecurInterval] = useState(1);

  const state = useAvailability({
    initialRev, initialDates, initialNotes,
    // A conflict drops the pending edits, so the popover can be pinned to a date
    // that is gone — it closes in the same update the adoption lands in.
    onAdopt: () => setPopover(null),
    onSaved: () => toast({ message: "Guardado", tone: "ok", duration: 2500 }),
  });
  const { notes, setNote, remove, applyRecurring, save, saving, dirty, changeCount, saveError, conflict, upcomingCount } = state;

  // «Marcar días» ⇄ «Listo»: the popover is anchored to a cell whose style the
  // flip changes, so it closes in the SAME update, not a render later. The grid
  // resets its own half-finished drag on the prop change.
  function toggleSelecting() {
    setPopover(null);
    setSelecting(v => !v);
  }

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

  // «Repetir…» is the panel's one disclosure: the range by dates moved into the
  // grid in F2 and retired in F3, so there is nothing left to keep it mutually
  // exclusive with.
  function toggleRecur() {
    setRecurOpen(v => !v);
  }

  return (
    <div>
      {/* The lede: the live count in the availability colour, then the one
          standing fact about the week. */}
      <p className="font-body text-[17px] leading-snug text-ink-dim md:text-xl">
        <span className="text-availability-soft">
          {upcomingCount === 0
            ? "Sin días marcados"
            : `${upcomingCount} día${upcomingCount === 1 ? "" : "s"} marcado${upcomingCount === 1 ? "" : "s"}`}
        </span>
        {" · el viernes es ensayo"}
      </p>

      {/* The actions, the mode hint, and the recurring panel one of them opens.
          They share a wrapper so the panel is not a spaced child: a closed
          Collapse is a zero-height child, but a gap around it would still be
          reserved. */}
      <div className="mt-6">
        <div className="flex items-center gap-2.5">
          {/* The primary action first: a member comes here to mark days.
              «Repetir…» is the quiet one beside it. */}
          <MarkDaysButton selecting={selecting} onToggle={toggleSelecting} />
          <Button
            variant="ghost"
            size="lg"
            onClick={toggleRecur}
            aria-expanded={recurOpen}
            aria-controls="availability-recur"
          >
            Repetir…
          </Button>
        </div>

        {/* One line in both states, so arming the mode never shifts the months
            under the finger that is about to drag on them. */}
        <p className="mt-3 font-body text-[15px] leading-snug text-ink-muted">
          {selecting
            ? "Toca un día para marcarlo. Mantén presionado y arrastra para marcar varios."
            : "Toca «Marcar días» para marcar o editar los días que no puedes."}
        </p>

        {/* Recurring pattern: a hairline block in the page's own type. */}
        <Collapse open={recurOpen} id="availability-recur" className="mt-4 space-y-3 border-t border-ink/[0.10] pt-4">
          <p className="font-body text-[15px] leading-snug text-ink-muted">
            Marca un día de la semana como no disponible durante los próximos 12 meses.
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
            <Button variant="secondary" onClick={() => applySeries(true)}>Marcar</Button>
            <Button variant="ghost" onClick={() => applySeries(false)}>Quitar serie</Button>
          </div>
          <p className="font-body text-sm text-ink-muted">
            <span className="text-ink-dim">Marcar</span> agrega o <span className="text-ink-dim">Quitar serie</span> borra ese día. Puedes ajustar días sueltos después; recuerda <span className="text-ink-dim">Guardar</span>.
          </p>
        </Collapse>
      </div>

      {/* The grid: the one surface that marks a date (F3). Mounted, never behind a
          disclosure — this page exists to show it. */}
      <div className="mt-9">
        <AvailabilityGrid
          state={state}
          selecting={selecting}
          services={services}
          openNote={openNote}
          closeNote={closeNote}
          noteIso={popover?.iso ?? null}
        />
      </div>

      <NotePopover
        popover={popover}
        setPopover={setPopover}
        anchorRef={anchorRef}
        notes={notes}
        setNote={setNote}
        remove={remove}
      />

      {/* The save bar: sticky (not fixed), so it rests in the flow at the end
          of the page and rises only while the months scroll past it. Present
          only with something to say — a bar reading «Sin cambios» would be a
          permanent strip across the bottom of a page most visits only read.
          It also carries the held CONFLICT notice: a 409 adopts the server's
          dates, so nothing is dirty any more and «Guardar» goes, but the
          member is still looking at the month they just marked, and the only
          explanation must be where their eyes are, not two screens up. `-mx-6
          px-6` runs it edge to edge across the page's gutters; the right
          padding steps aside for the admin assistant's bubble, which would
          otherwise sit on «Guardar» (`--assistant-fab-w`). */}
      {(dirty || saving || conflict) && (
        <div
          data-availability-save-bar=""
          className="sticky bottom-[var(--bottom-nav-h,0px)] z-20 -mx-6 mt-8 flex items-center gap-3 border-t border-ink/[0.10] bg-surface-base px-6 py-3 pr-[calc(1.5rem+var(--assistant-fab-w,0px))]"
        >
          <p role="status" className="min-w-0 flex-1 font-body text-[15px] text-ink-muted">
            {conflict ? (
              <span className="text-negative-fg">{conflict}</span>
            ) : saveError ? (
              <span className="text-negative-fg">No se pudo guardar — {saveError}</span>
            ) : (
              <>
                <span className="font-semibold text-ink">{changeCount} cambio{changeCount === 1 ? "" : "s"}</span> sin guardar
              </>
            )}
          </p>
          {(dirty || saving) && (
            <Button
              variant="primary"
              size="lg"
              onClick={save}
              busy={saving}
              busyLabel="Guardando…"
              className="shrink-0"
            >
              Guardar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
