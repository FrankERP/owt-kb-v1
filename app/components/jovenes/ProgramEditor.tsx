"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "@/app/components/ui/icons";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { programBody, programForm, type LineForm } from "@/app/utils/jovenesPlannerModel";
import { dayTitle } from "@/app/utils/agenda";
import { audienceLabel, eventDayLabel, eventName } from "@/app/utils/jovenesEventView";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import { programUrl, sendEventWrite } from "./eventWrite";

const MAX_LINES = 20;

/**
 * «Editar programa» — who gives the prayer, who runs the dynamic, and the rest of a meeting's
 * program (Frank, 2026-10-30). Shown to a Jóvenes admin and to the encargado or apoyo of a
 * whole-ministry meeting; the program PATCH writes ONLY `program`, whatever else it is sent (W4),
 * and decides again on the stored event who may.
 *
 * The lines are a numbered list between hairlines, each with its three fields labelled alike and
 * its order and removal as icon buttons at the side (2026-11-10): a bordered box per line with
 * three text buttons under it made a five-line program a long form of buttons.
 */
export default function ProgramEditor({
  event,
  people,
  compact = false,
}: {
  event: MinistryEventView;
  people: readonly JovenesPerson[];
  /** Beside «Editar» in a planner row: a quiet «Programa». It still answers to «Editar programa». */
  compact?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineForm[]>([]);
  // The revision the lines were opened FROM, held with them: a refresh that brings a newer event
  // must never let these lines save over it (the encargado and the apoyo edit the same program).
  const [rev, setRev] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = new Map(event.program.map((l) => [l._key, l.name]));

  function openEditor() {
    setLines(programForm(event.program));
    setRev(event.rev);
    setError(null);
    setOpen(true);
  }

  function edit(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function move(i: number, by: -1 | 1) {
    setLines((ls) => {
      const j = i + by;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (saving) return;
    if (!rev) {
      setError("Recarga la página para editar este programa.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await sendEventWrite("PATCH", programUrl(event.ministry, event._id), {
        _rev: rev,
        program: programBody(lines),
      });
      if (!r.ok) {
        if (r.stale) {
          // Someone saved first: close, so the next open starts from THEIR lines and revision.
          setOpen(false);
          toast({ message: `${r.message} Ábrelo de nuevo para ver los cambios.`, tone: "error" });
          router.refresh();
          return;
        }
        setError(r.message);
        return;
      }
      setOpen(false);
      toast({ message: "Programa guardado", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {compact ? (
        <Button variant="ghost" size="sm" aria-label="Editar programa" onClick={openEditor}>
          Programa
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={openEditor}>
          Editar programa
        </Button>
      )}
      <CueDialog
        open={open}
        mode="sheet"
        size="lg"
        label={`Programa — ${eventDayLabel(event.date)}`}
        onDismiss={() => !saving && setOpen(false)}
        title="Programa"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
          <p className="font-body text-[17px] leading-snug text-ink-dim">
            {dayTitle(event.date)} · <span className="text-ink">{eventName(event) ?? audienceLabel(event.audience)}</span>
          </p>
          {lines.length === 0 ? (
            <p className="font-body text-[15px] text-ink-muted">Aún no hay líneas. Agrega la oración, la dinámica y lo demás.</p>
          ) : (
            <ol className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
              {lines.map((l, i) => (
                <li key={l.key ?? `new-${i}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 py-4">
                  <span aria-hidden="true" className="pt-5 font-display text-[22px] font-semibold leading-none tabular-nums text-ink">
                    {i + 1}
                  </span>
                  <fieldset className="min-w-0 space-y-4">
                    <legend className="sr-only">Línea {i + 1}</legend>
                    <label className="block">
                      <span className={HAIRLINE_LABEL_CLASS}>Qué</span>
                      <input
                        className={HAIRLINE_INPUT_CLASS}
                        value={l.label}
                        maxLength={60}
                        placeholder="Oración, dinámica, alabanza…"
                        onChange={(e) => edit(i, { label: e.target.value })}
                      />
                    </label>
                    <div>
                      {/* A visible label like its two neighbours; the control keeps its own name. */}
                      <span aria-hidden="true" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                        Quién
                      </span>
                      <PersonSelect
                        ariaLabel={`Quién — línea ${i + 1}`}
                        value={l.member}
                        people={people}
                        storedName={l.key ? names.get(l.key) : null}
                        onChange={(member) => edit(i, { member })}
                      />
                    </div>
                    <label className="block">
                      <span className={HAIRLINE_LABEL_CLASS}>Nota</span>
                      <input
                        className={HAIRLINE_INPUT_CLASS}
                        value={l.note}
                        maxLength={300}
                        placeholder="Opcional"
                        onChange={(e) => edit(i, { note: e.target.value })}
                      />
                    </label>
                  </fieldset>
                  <div className="-mr-2 flex flex-col">
                    <Button variant="icon" size="lg" aria-label={`Subir línea ${i + 1}`} onClick={() => move(i, -1)} disabled={i === 0}>
                      <ChevronUpIcon size={16} />
                    </Button>
                    <Button
                      variant="icon"
                      size="lg"
                      aria-label={`Bajar línea ${i + 1}`}
                      onClick={() => move(i, 1)}
                      disabled={i === lines.length - 1}
                    >
                      <ChevronDownIcon size={16} />
                    </Button>
                    <Button
                      variant="icon"
                      size="lg"
                      tone="danger"
                      aria-label={`Quitar línea ${i + 1}`}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <CloseIcon size={16} />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {lines.length < MAX_LINES && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLines((ls) => [...ls, { key: null, label: "", member: null, note: "" }])}
            >
              Agregar línea
            </Button>
          )}
          {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="lg" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" size="lg" onClick={save} busy={saving} busyLabel="Guardando…">
              Guardar programa
            </Button>
          </div>
        </div>
      </CueDialog>
    </>
  );
}
