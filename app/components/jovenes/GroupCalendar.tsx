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
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { DOW_SHORT } from "@/app/utils/agenda";
import { audienceLabel, dayWords, eventHeading } from "@/app/utils/jovenesEventView";
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
import MeetingState from "./MeetingState";
import { eventUrl, eventsUrl, sendEventWrite } from "./eventWrite";

const MINISTRY = "jovenes";

/** «mié 18 de noviembre»: the short weekday and the date, in a row that already leads with the number. */
function shortDay(date: string): string {
  const words = dayWords(date);
  return `${DOW_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()].toLowerCase()} ${words.slice(words.indexOf(" ") + 1)}`;
}

type Editing = { event: MinistryEventView | null; form: GroupEventForm; token: string };

/**
 * The groups' calendars in Planear Jóvenes (PR D, ADR-0081): the month's meetings of one group or
 * shared by several. A leader creates them for their groups and edits a one-group meeting of a
 * group they lead; a shared one only its creator and the admins edit (Frank, 2026-11-04). The
 * buttons follow those rules from `viewer`, but only to save a refusal: every write is decided
 * again by the server on the stored meeting. The rows come from the editor-mode read, so a leader
 * never receives another group's meetings to begin with.
 *
 * Hairline rows led by the day number, like the roster above and the Calendario's agenda; the
 * state as a dot and a word; house buttons for the actions (2026-11-10, ADR-0070).
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
    const problem = groupEventProblem(form, viewer);
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
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <h2 id="jovenes-group-calendar" className={SHEET_TITLE}>
          Calendario de grupos
        </h2>
        {canCreateGroupEvent(viewer) && (
          // The section title already says «de grupos»; the name the button answers to keeps it.
          <Button variant="secondary" size="sm" aria-label="Nueva reunión de grupo" onClick={() => open(null)}>
            Nueva reunión
          </Button>
        )}
      </header>

      {events.length === 0 ? (
        <p className="border-y border-ink/[0.10] py-8 font-body text-[15px] text-ink-muted">No hay reuniones de grupo este mes.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.10] border-y border-ink/[0.10]">
          {events.map((e) => {
            const joint = e.audience?.kind === "groups" && e.audience.groups.length > 1;
            return (
              <li key={e._id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3.5 py-4">
                <span className="pt-0.5 text-center font-display text-[30px] font-semibold leading-none tabular-nums text-ink">
                  {Number(e.date.slice(8))}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="font-body text-[17px] font-semibold leading-tight text-ink">
                    {eventHeading(e)}
                    {e.time && <span className="font-normal tabular-nums text-ink-dim"> · {e.time}</span>}
                  </p>
                  <p className="font-body text-[15px] leading-snug text-ink-dim">
                    {shortDay(e.date)} · {audienceLabel(e.audience)}
                  </p>
                  {joint && (
                    <p className="font-body text-[13px] text-ink-muted">Creada por {e.createdByName ?? "alguien que ya no está"}</p>
                  )}
                  {e.notes && <p className="whitespace-pre-line font-body text-[15px] leading-snug text-ink-muted">{e.notes}</p>}
                  <p>
                    <MeetingState published={e.published} />
                  </p>
                </div>
                {canEditGroupEvent(e, viewer) ? (
                  <Button variant="secondary" size="sm" onClick={() => open(e)}>
                    Editar
                  </Button>
                ) : (
                  <span />
                )}
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
