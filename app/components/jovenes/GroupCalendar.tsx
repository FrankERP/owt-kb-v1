"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import Checkbox from "@/app/components/ui/Checkbox";
import CueDialog from "@/app/components/ui/CueDialog";
import CueDialogStatus from "@/app/components/ui/CueDialogStatus";
import DateField from "@/app/components/ui/DateField";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { HAIRLINE_INPUT_CLASS, HAIRLINE_LABEL_CLASS } from "@/app/components/ui/hairlineField";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { dayTitle } from "@/app/utils/agenda";
import { eventHeading } from "@/app/utils/jovenesEventView";
import { audienceTone } from "@/app/utils/jovenesGroupStyle";
import {
  JOVENES_GROUPS,
  canCreateGroupEvent,
  canEditGroupEvent,
  editLosesAccess,
  groupEventBody,
  groupEventForm,
  groupEventProblem,
  type GroupEventForm,
  type PlannerViewer,
} from "@/app/utils/jovenesPlannerModel";
import { CalendarOffIcon, NoteIcon, PlusIcon, UsersIcon } from "@/app/components/ui/icons";
import AudienceChips from "./AudienceChips";
import AudienceRail from "./AudienceRail";
import DateTile from "./DateTile";
import MeetingMeta from "./MeetingMeta";
import MeetingState from "./MeetingState";
import SectionHead from "./SectionHead";
import { eventUrl, eventsUrl, halfTypedClock, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";

type Editing = { event: MinistryEventView | null; form: GroupEventForm; token: string };

/**
 * The groups' calendars in Planear Jóvenes (PR D, ADR-0081): the month's meetings of one group or
 * shared by several. A leader creates them for their groups and edits a one-group meeting of a
 * group they lead; a shared one only its creator and the admins edit (Frank, 2026-11-04). The
 * buttons follow those rules from `viewer`, but only to save a refusal: every write is decided
 * again by the server on the stored meeting. The rows come from the editor-mode read, so a leader
 * never receives another group's meetings to begin with.
 *
 * A card per meeting in its group's colour, the date as a leaf like the roster above, the state
 * as a pill, house buttons for the actions (2026-11-12, ADR-0086; hairline rows before).
 */
export default function GroupCalendar({
  events,
  viewer,
  defaultDate,
}: {
  events: MinistryEventView[];
  viewer: PlannerViewer;
  /** Where a new meeting starts: today in the current month, else the month's first day. */
  defaultDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(event: MinistryEventView | null) {
    // The create token is minted when the editor opens, so a double tap or a retry names the
    // same meeting (W6) instead of making two.
    setEditing({ event, form: groupEventForm(defaultDate, viewer, event ?? undefined), token: crypto.randomUUID() });
    setConfirmDelete(false);
    setError(null);
  }

  function patchForm(patch: Partial<GroupEventForm>) {
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  }

  function toggleGroup(id: string, on: boolean) {
    setEditing((e) => {
      if (!e) return e;
      const groups = on ? [...new Set([...e.form.groups, id])] : e.form.groups.filter((g) => g !== id);
      return { ...e, form: { ...e.form, groups } };
    });
  }

  /** A 409 (someone saved first, or this create already landed): close, re-read, say so. */
  function closeStale(message: string) {
    setEditing(null);
    toast({ message: `${message} Ábrela de nuevo para ver los cambios.`, tone: "error" });
    router.refresh();
  }

  async function save() {
    if (!editing || saving) return;
    const { form, event, token } = editing;
    const problem = groupEventProblem(form, viewer) ?? halfTypedClock(["jovenes-group-time"]);
    if (problem) {
      setError(problem);
      return;
    }
    if (event && !event.rev) {
      setError("Recarga la página para editar esta reunión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = groupEventBody({ ...form, time: form.time.trim() });
      const r = event
        ? await sendEventWrite("PATCH", eventUrl(MINISTRY, event._id), { ...body, _rev: event.rev })
        : await sendEventWrite("POST", eventsUrl(MINISTRY), { ...body, token });
      if (!r.ok) {
        if (r.stale) return closeStale(r.message);
        setError(r.message);
        return;
      }
      setEditing(null);
      toast({ message: event ? "Reunión guardada" : "Reunión creada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const event = editing?.event;
    if (!event || saving) return;
    if (!event.rev) {
      setError("Recarga la página para borrar esta reunión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await sendEventWrite("DELETE", eventUrl(MINISTRY, event._id), { _rev: event.rev });
      if (!r.ok) {
        if (r.stale) return closeStale(r.message);
        setError(r.message);
        return;
      }
      setEditing(null);
      toast({ message: "Reunión borrada", tone: "ok" });
      router.refresh();
    } catch {
      setError("No se pudo borrar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const losing = editing ? editLosesAccess(editing.event, editing.form, viewer) : false;

  return (
    <section aria-labelledby="jovenes-group-calendar">
      <SectionHead
        id="jovenes-group-calendar"
        icon={<UsersIcon size={20} />}
        title="Calendario de grupos"
        note="Las de cada grupo y las compartidas."
      >
        {canCreateGroupEvent(viewer) && (
          // The section title already says «de grupos»; the name the button answers to keeps it.
          <Button variant="secondary" size="sm" aria-label="Nueva reunión de grupo" onClick={() => open(null)}>
            <PlusIcon size={13} />
            Nueva reunión
          </Button>
        )}
      </SectionHead>

      {events.length === 0 ? (
        <p className="flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-10 text-center font-body text-[15px] text-ink-muted">
          <CalendarOffIcon size={24} className="text-ink-dim" />
          No hay reuniones de grupo este mes.
        </p>
      ) : (
        // A card per meeting, in its group's colour (ADR-0086): the rail and the date leaf's band
        // take it, and a shared meeting shows one rail segment and one chip per group.
        <ul className="space-y-3">
          {events.map((e) => {
            const joint = e.audience?.kind === "groups" && e.audience.groups.length > 1;
            return (
              <li key={e._id} className="brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)]">
                <AudienceRail audience={e.audience} muted={!e.published} />
                <div className="flex gap-3.5 py-4 pl-5 pr-4">
                  <DateTile date={e.date} tone={audienceTone(e.audience)} decorative />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        <h3 className="min-w-0 break-words pt-0.5 font-display text-[22px] font-semibold uppercase leading-none tracking-[0.02em] text-ink md:text-2xl">
                          {eventHeading(e)}
                          <span className="sr-only">, {dayTitle(e.date)}</span>
                        </h3>
                        <MeetingState published={e.published} />
                      </div>
                      {canEditGroupEvent(e, viewer) && (
                        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => open(e)}>
                          Editar
                        </Button>
                      )}
                    </div>
                    <MeetingMeta time={e.time} arrival={e.arrival} place={e.place} />
                    <AudienceChips audience={e.audience} />
                    {joint && (
                      <p className="font-body text-[13px] text-ink-dim">Creada por {e.createdByName ?? "alguien que ya no está"}</p>
                    )}
                    {e.notes && (
                      <p className="flex gap-2.5 rounded-xl bg-ink/[0.05] px-3.5 py-2.5 font-body text-[15px] leading-snug text-ink-muted">
                        <NoteIcon size={15} className="mt-[3px] shrink-0 text-ink-dim" />
                        <span className="min-w-0 whitespace-pre-line break-words">{e.notes}</span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CueDialog
        open={editing !== null}
        mode="sheet"
        size="lg"
        label={editing?.event ? "Editar reunión de grupo" : "Nueva reunión de grupo"}
        onDismiss={() => !saving && setEditing(null)}
        title={editing?.event ? "Editar reunión de grupo" : "Nueva reunión de grupo"}
      >
        {editing && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            {/* Fecha and Hora are the same house field at the same height: a boxed date beside a
                hairline clock read as two different forms. The native clock also spares the
                phone's digits-only keyboard, which has no «:» to type «19:30» with. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="jovenes-group-date" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                  Fecha
                </label>
                <DateField
                  kind="date"
                  size="lg"
                  id="jovenes-group-date"
                  value={editing.form.date}
                  onChange={(e) => patchForm({ date: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="jovenes-group-time" className={`${HAIRLINE_LABEL_CLASS} mb-1.5 block`}>
                  Hora
                </label>
                <DateField
                  kind="time"
                  size="lg"
                  id="jovenes-group-time"
                  value={editing.form.time}
                  onChange={(e) => patchForm({ time: e.target.value })}
                />
              </div>
            </div>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Qué</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={80}
                placeholder="Reunión de grupo"
                value={editing.form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Lugar</span>
              <input
                className={HAIRLINE_INPUT_CLASS}
                maxLength={120}
                placeholder="Por ejemplo Casa Fam Varela"
                value={editing.form.place}
                onChange={(e) => patchForm({ place: e.target.value.replace(/[\r\n\u2028\u2029]/g, " ") })}
              />
            </label>
            <fieldset className="space-y-2.5">
              <legend className={HAIRLINE_LABEL_CLASS}>Grupos</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {JOVENES_GROUPS.map((g) => (
                  <Checkbox
                    key={g.id}
                    checked={editing.form.groups.includes(g.id)}
                    onChange={(e) => toggleGroup(g.id, e.target.checked)}
                  >
                    <span className="font-body text-[17px] text-ink">{g.name}</span>
                  </Checkbox>
                ))}
              </div>
              {editing.form.groups.length > 1 && (
                <p className="font-body text-[13px] leading-snug text-ink-muted">
                  Una reunión compartida la ven completa los grupos que participan. Solo quien la creó y los admins pueden cambiarla.
                </p>
              )}
            </fieldset>
            <label className="block">
              <span className={HAIRLINE_LABEL_CLASS}>Notas</span>
              <textarea
                className={`${HAIRLINE_INPUT_CLASS} min-h-[5rem] resize-y`}
                maxLength={2000}
                value={editing.form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
              />
            </label>
            <div className="flex items-center justify-between gap-4 border-t border-ink/[0.10] pt-4">
              <span id="jovenes-group-published" className="min-w-0">
                <span className="block font-body text-[17px] text-ink">Publicada</span>
                <span className="block font-body text-[13px] text-ink-muted">La ven sus grupos</span>
              </span>
              <Switch
                aria-labelledby="jovenes-group-published"
                checked={editing.form.published}
                onChange={(published) => patchForm({ published })}
              />
            </div>
            {losing && (
              <p role="status" className="border-l-2 border-warning-fg/60 py-1 pl-4 font-body text-[15px] leading-snug text-warning-soft">
                Al compartirla con otro grupo, ya no podrás editarla: solo quien la creó y los admins.
              </p>
            )}
            {error && <CueDialogStatus tone="error">{error}</CueDialogStatus>}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {editing.event ? (
                confirmDelete ? (
                  <Button variant="danger" size="lg" onClick={remove} busy={saving} busyLabel="Borrando…">
                    Sí, borrar
                  </Button>
                ) : (
                  <Button variant="ghost" size="lg" onClick={() => setConfirmDelete(true)} disabled={saving}>
                    Borrar reunión
                  </Button>
                )
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" size="lg" onClick={() => setEditing(null)} disabled={saving}>
                  Cancelar
                </Button>
                <Button variant="primary" size="lg" onClick={save} busy={saving} busyLabel="Guardando…">
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}
      </CueDialog>
    </section>
  );
}
