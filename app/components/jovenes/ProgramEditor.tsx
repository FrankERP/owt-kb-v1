"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "@/app/components/ui/icons";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { PROGRAM_MAX_LINES, programBody, programForm, type LineForm } from "@/app/utils/jovenesPlannerModel";
import { PLATICA_SEAT, hasFixedProgram, musicChip, partSpec } from "@/app/utils/ministryParts";
import { meetingPath } from "@/app/utils/jovenesPartView";
import { dayTitle } from "@/app/utils/agenda";
import { audienceLabel, eventDayLabel, eventName } from "@/app/utils/jovenesEventView";
import PersonSelect, { type JovenesPerson } from "./PersonSelect";
import { programUrl, sendEventWrite } from "./eventWrite";

/**
 * «Editar programa» — who gives the prayer, who runs each dynamic, and the rest of a meeting's
 * program (Frank, 2026-10-30). Shown to a Jóvenes admin and to the encargado or apoyo of a
 * whole-ministry meeting; the program PATCH writes ONLY `program`, whatever else it is sent (W4),
 * and decides again on the stored event who may.
 *
 * Two blocks since ADR-0089. THE PARTS (the Saturday meeting always has Oración and the two
 * dinámicas; any other meeting, the ones it holds): here one only says WHO — one person for the
 * prayer, up to two per dinámica. What each responsable wrote (description, music, who helps)
 * rides along in the form untouched and is shown, read-only, under their names: it is theirs to
 * fill («Mi parte»), and saving people must never clear it. Plática takes no person here; whoever
 * holds «Comparte» gives it. THE OTHER MOMENTS are the free lines, as before: a numbered list
 * between hairlines, order and removal as icon buttons at the side (2026-11-10).
 */
export default function ProgramEditor({
  event,
  people,
  compact = false,
}: {
  event: MinistryEventView;
  people: readonly JovenesPerson[];
  /** Beside «Editar» in a planner card: the short «Programa», a button like its neighbour (on a
   *  phone the two share a row in halves). It still answers to «Editar programa». */
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

  // A stored person's name by member id, for one who is no longer in the list (either slot).
  const names = new Map<string, string | null>();
  for (const l of event.program) {
    if (l.memberId) names.set(l.memberId, l.name);
    if (l.second?.memberId) names.set(l.second.memberId, l.second.name);
  }
  const speakers = event.seats.filter((s) => s.role === PLATICA_SEAT && s.name).map((s) => s.name as string);

  function openEditor() {
    setLines(programForm(event.program, hasFixedProgram(event)));
    setRev(event.rev);
    setError(null);
    setOpen(true);
  }

  function edit(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  /** Swap a free line with the free line before or after it; the parts keep their place. */
  function move(i: number, by: -1 | 1) {
    setLines((ls) => {
      const j = i + by;
      if (j < 0 || j >= ls.length || ls[i].part || ls[j].part) return ls;
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
    const twice = lines.find((l) => l.part && l.member && l.member === l.member2);
    if (twice) {
      setError(`${twice.label}: elige a dos personas distintas, o deja la segunda sin asignar.`);
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

  // Indexes into `lines`, so both blocks edit the one array the body is built from.
  const parts = lines.map((l, i) => ({ l, i })).filter((x) => x.l.part);
  const free = lines.map((l, i) => ({ l, i })).filter((x) => !x.l.part);
  const firstFree = free[0]?.i ?? -1;
  const lastFree = free[free.length - 1]?.i ?? -1;

  return (
    <>
      {compact ? (
        <Button variant="secondary" size="sm" aria-label="Editar programa" onClick={openEditor}>
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

          {parts.length > 0 && (
            <section aria-labelledby="program-parts" className="space-y-1">
              <h3 id="program-parts" className={HAIRLINE_LABEL_CLASS}>
                Partes de la reunión
              </h3>
              <p className="font-body text-[15px] leading-snug text-ink-muted">
                Elige quién tiene cada parte. Cada responsable recibe un correo y llena lo suyo.{" "}
                {/* The entrance for whoever fills a part for somebody else (plan U2): an admin, the
                    encargado, the topic of a «comparte» written by name. */}
                <Link href={meetingPath(event._id)} className="font-semibold text-accent underline-offset-2 hover:underline">
                  Llenar una parte por alguien más{"\u00a0"}→
                </Link>
              </p>
              <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10] !mt-3">
                {parts.map(({ l, i }) => {
                  const spec = partSpec(l.part);
                  if (!spec) return null;
                  const chip = musicChip(l.part, l.music);
                  const filled = [l.note.trim(), l.helpers.trim() ? `Apoyan: ${l.helpers.trim()}` : "", chip ?? ""].filter(Boolean);
                  return (
                    <li key={spec.id} className="py-4">
                      <fieldset className="min-w-0 space-y-3">
                        <legend className="font-display text-[20px] font-semibold uppercase leading-none tracking-[0.02em] text-ink">
                          {spec.label}
                        </legend>
                        {spec.people === 0 ? (
                          <p className="font-body text-[15px] leading-snug text-ink-muted">
                            La da quien está en «Comparte»:{" "}
                            <span className="text-ink">{speakers.length ? speakers.join(" y ") : "sin asignar"}</span>. Se cambia al editar
                            la reunión.
                          </p>
                        ) : (
                          <div className={spec.people === 2 ? "grid gap-3 sm:grid-cols-2" : ""}>
                            <div>
                              <span aria-hidden="true" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                                {spec.people === 2 ? "Responsable" : "Quién"}
                              </span>
                              <PersonSelect
                                ariaLabel={spec.people === 2 ? `${spec.label}: responsable` : `${spec.label}: quién`}
                                value={l.member}
                                people={people}
                                storedName={l.member ? names.get(l.member) : null}
                                onChange={(member) => edit(i, { member })}
                              />
                            </div>
                            {spec.people === 2 && (
                              <div>
                                <span aria-hidden="true" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                                  Segundo responsable (opcional)
                                </span>
                                <PersonSelect
                                  ariaLabel={`${spec.label}: segundo responsable`}
                                  value={l.member2}
                                  people={people}
                                  storedName={l.member2 ? names.get(l.member2) : null}
                                  onChange={(member2) => edit(i, { member2 })}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {filled.length > 0 && (
                          <p className="break-words font-body text-[14px] leading-snug text-ink-muted">
                            <span className="text-ink-dim">Ya llenó: </span>
                            {filled.join(" · ")}
                          </p>
                        )}
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="program-free" className="space-y-3">
            {parts.length > 0 && (
              <h3 id="program-free" className={HAIRLINE_LABEL_CLASS}>
                Otros momentos
              </h3>
            )}
            {free.length === 0 ? (
              <p className="font-body text-[15px] text-ink-muted">
                {parts.length > 0
                  ? "Bienvenida, anuncios, lo que no sea una de las partes de arriba."
                  : "Aún no hay líneas. Agrega la oración, la dinámica y lo demás."}
              </p>
            ) : (
              <ol className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
                {free.map(({ l, i }, n) => (
                  <li key={l.key ?? `new-${i}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 py-4">
                    <span aria-hidden="true" className="pt-5 font-display text-[22px] font-semibold leading-none tabular-nums text-ink">
                      {n + 1}
                    </span>
                    <fieldset className="min-w-0 space-y-4">
                      <legend className="sr-only">Línea {n + 1}</legend>
                      <label className="block">
                        <span className={HAIRLINE_LABEL_CLASS}>Qué</span>
                        <input
                          className={HAIRLINE_INPUT_CLASS}
                          value={l.label}
                          maxLength={60}
                          placeholder={parts.length > 0 ? "Bienvenida, anuncios…" : "Oración, dinámica, alabanza…"}
                          onChange={(e) => edit(i, { label: e.target.value })}
                        />
                      </label>
                      <div>
                        {/* A visible label like its two neighbours; the control keeps its own name. */}
                        <span aria-hidden="true" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                          Quién
                        </span>
                        <PersonSelect
                          ariaLabel={`Quién — línea ${n + 1}`}
                          value={l.member}
                          people={people}
                          storedName={l.member ? names.get(l.member) : null}
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
                      <Button variant="icon" size="lg" aria-label={`Subir línea ${n + 1}`} onClick={() => move(i, -1)} disabled={i === firstFree}>
                        <ChevronUpIcon size={16} />
                      </Button>
                      <Button variant="icon" size="lg" aria-label={`Bajar línea ${n + 1}`} onClick={() => move(i, 1)} disabled={i === lastFree}>
                        <ChevronDownIcon size={16} />
                      </Button>
                      <Button
                        variant="icon"
                        size="lg"
                        tone="danger"
                        aria-label={`Quitar línea ${n + 1}`}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        <CloseIcon size={16} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {lines.length < PROGRAM_MAX_LINES && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setLines((ls) => [...ls, { key: null, label: "", part: null, member: null, member2: null, note: "", music: null, helpers: "" }])
                }
              >
                Agregar línea
              </Button>
            )}
          </section>
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
