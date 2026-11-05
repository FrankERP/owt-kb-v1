"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { programBody, programForm, type LineForm } from "@/app/utils/jovenesPlannerModel";
import { eventDayLabel, eventHeading } from "@/app/utils/jovenesEventView";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import { programUrl, sendEventWrite } from "./eventWrite";

const MAX_LINES = 20;

/**
 * «Editar programa» — who gives the prayer, who runs the dynamic, and the rest of a meeting's
 * program (Frank, 2026-10-30). Shown to a Jóvenes admin and to the encargado or apoyo of a
 * whole-ministry meeting; the program PATCH writes ONLY `program`, whatever else it is sent (W4),
 * and decides again on the stored event who may.
 */
export default function ProgramEditor({ event, people }: { event: MinistryEventView; people: readonly JovenesPerson[] }) {
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
      <Button variant="pill" size="sm" onClick={openEditor}>
        Editar programa
      </Button>
      <CueDialog
        open={open}
        mode="sheet"
        size="lg"
        label={`Programa — ${eventDayLabel(event.date)}`}
        onDismiss={() => !saving && setOpen(false)}
        title={
          <span className="block">
            <span className="block font-display text-base uppercase tracking-wide text-ink">Programa</span>
            <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">
              {eventHeading(event)} · {eventDayLabel(event.date)}
            </span>
          </span>
        }
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {lines.length === 0 && (
            <p className="font-body text-sm text-mono-500">Aún no hay líneas. Agrega la oración, la dinámica y lo demás.</p>
          )}
          {lines.map((l, i) => (
            <fieldset key={l.key ?? `new-${i}`} className="space-y-2 rounded-xl border border-edge-accent-subtle p-3">
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
              <PersonSelect
                ariaLabel={`Quién — línea ${i + 1}`}
                value={l.member}
                people={people}
                storedName={l.key ? names.get(l.key) : null}
                onChange={(member) => edit(i, { member })}
              />
              <label className="block">
                <span className={HAIRLINE_LABEL_CLASS}>Nota</span>
                <input
                  className={HAIRLINE_INPUT_CLASS}
                  value={l.note}
                  maxLength={300}
                  onChange={(e) => edit(i, { note: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                  Subir
                </Button>
                <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === lines.length - 1}>
                  Bajar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  Quitar
                </Button>
              </div>
            </fieldset>
          ))}
          {lines.length < MAX_LINES && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setLines((ls) => [...ls, { key: null, label: "", member: null, note: "" }])}
            >
              Agregar línea
            </Button>
          )}
          {error && (
            <p role="alert" className="font-body text-sm text-negative-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
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
